# 방송 하이라이트: 스트리머 채널 연결 API (M5, docs/HIGHLIGHT.md, ADR-015·039)
# 치지직 OAuth → 우리 세션(HttpOnly 쿠키). 플랫폼 토큰은 채널마다 SSM SecureString 하나 (aws/ssm 키, 고정 비용 없음)
# 클라이언트 시크릿은 사용자가 로컬에서 SSM에 넣는다 (저장소·상태 파일에 두지 않는다)

locals {
  tags         = { Component = var.component }
  fn           = "${var.name_prefix}-highlight-api"
  token_prefix = "${var.ssm_prefix}streamer/"
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  ssm_arn_prefix = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter"
}

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

  # 세션(SESS#), 로그인 state(OAUTH#), 연결 정보(CONN#)
  statement {
    sid       = "Table"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [var.table_arn]
  }

  statement {
    sid       = "ReadSecrets"
    actions   = ["ssm:GetParameter"]
    resources = [var.origin_param_arn, "${local.ssm_arn_prefix}${var.chzzk_secret_param}"]
  }

  # 스트리머 토큰: 채널마다 파라미터 하나. 연결 해제하면 바로 지운다
  statement {
    sid       = "StreamerTokens"
    actions   = ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"]
    resources = ["${local.ssm_arn_prefix}${local.token_prefix}*"]
  }

  # SecureString 암호화·복호화. AWS 관리형 키를 SSM을 거쳐서만 쓴다
  statement {
    sid       = "SsmKey"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "highlight-api"
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
  timeout          = 15
  tags             = local.tags

  environment {
    variables = {
      TABLE_NAME         = var.table_name
      ORIGIN_PARAM       = var.origin_param_name
      CHZZK_CLIENT_ID    = var.chzzk_client_id
      CHZZK_SECRET_PARAM = var.chzzk_secret_param
      TOKEN_PREFIX       = local.token_prefix
      REDIRECT_URI       = "${var.site_origin}/api/streamer/chzzk/callback"
      NODE_OPTIONS       = "--enable-source-maps"
    }
  }

  depends_on = [aws_iam_role_policy.api, aws_cloudwatch_log_group.api]
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  for_each = toset([
    "GET /api/streamer/chzzk/login",
    "GET /api/streamer/chzzk/callback",
    "GET /api/streamer/me",
    "POST /api/streamer/logout",
    "DELETE /api/streamer/connection",
  ])
  api_id    = var.api_id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
