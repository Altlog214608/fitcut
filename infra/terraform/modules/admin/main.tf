# 관리자: Cognito 사용자 풀(셀프 가입 끔, TOTP MFA 필수, admin 그룹) + 관리자 API (ADR-011, docs/ADMIN.md 접근 통제)
# API Gateway JWT 권한 부여자가 토큰을 검사하고, Lambda가 admin 그룹을 다시 본다.
# 관리자 계정은 이메일이 들어가므로 Terraform이 아니라 사용자가 로컬에서 만든다 (README 안내).

locals {
  tags = { Component = var.component }
  fn   = "${var.name_prefix}-admin-api"
}

data "aws_region" "current" {}

# ---------- Cognito ----------

resource "aws_cognito_user_pool" "admin" {
  name                = "${var.name_prefix}-admin"
  user_pool_tier      = "LITE"
  username_attributes = ["email"]
  mfa_configuration   = "ON"
  deletion_protection = "ACTIVE"
  tags                = local.tags

  software_token_mfa_configuration {
    enabled = true
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 3
  }

  # 비밀번호 찾기는 관리자 콘솔에서만 (이메일 발송을 쓰지 않는다)
  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.admin.id
  description  = "FitCut admins"
}

# 브라우저용 앱 클라이언트 (비밀 없음). 화면이 Cognito 공개 인증 API를 직접 부른다
resource "aws_cognito_user_pool_client" "web" {
  name                          = "${var.name_prefix}-admin-web"
  user_pool_id                  = aws_cognito_user_pool.admin.id
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 1
  id_token_validity             = 1
  refresh_token_validity        = 1

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

# ---------- 관리자 API Lambda ----------

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name                 = local.fn
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda.json
  permissions_boundary = var.workload_boundary_arn
  tags                 = local.tags
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  statement {
    sid       = "Table"
    actions   = ["dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:PutItem"]
    resources = [var.table_arn]
  }

  statement {
    sid       = "OriginSecret"
    actions   = ["ssm:GetParameter"]
    resources = [var.origin_param_arn]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "admin-api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.fn}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "api" {
  function_name    = local.fn
  role             = aws_iam_role.api.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = var.lambda_zip
  source_code_hash = var.lambda_zip_hash
  memory_size      = 256
  timeout          = 10
  tags             = local.tags

  environment {
    variables = {
      TABLE_NAME   = var.table_name
      ORIGIN_PARAM = var.origin_param_name
      NODE_OPTIONS = "--enable-source-maps"
    }
  }

  depends_on = [aws_iam_role_policy.api, aws_cloudwatch_log_group.api]
}

# ---------- HTTP API: JWT 권한 부여자 + 관리자 경로 ----------

resource "aws_apigatewayv2_authorizer" "admin" {
  api_id           = var.api_id
  name             = "${var.name_prefix}-admin-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.x-admin-token"]

  jwt_configuration {
    # 액세스 토큰에는 aud가 없고 client_id가 있다. API Gateway는 둘 중 하나가 맞으면 받는다
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.admin.id}"
  }
}

resource "aws_apigatewayv2_integration" "admin" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "admin" {
  for_each           = toset(["GET /api/admin/stats", "GET /api/admin/audit"])
  api_id             = var.api_id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.admin.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.admin.id
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
