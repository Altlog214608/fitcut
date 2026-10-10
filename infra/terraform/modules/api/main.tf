# 잡 API: HTTP API + Lambda + DynamoDB + 업로드·결과 S3 (docs/ARCHITECTURE.md 요청 흐름 1~2단계).
# 쓰지 않을 때 비용이 0인 리소스만 쓴다 (DynamoDB 온디맨드, Lambda, HTTP API, S3 수명 주기).

locals {
  tags = { Component = var.component }
  fn   = "${var.name_prefix}-api"
}

resource "random_id" "suffix" {
  byte_length = 4
}

# ---------- DynamoDB (단일 테이블, 온디맨드) ----------

resource "aws_dynamodb_table" "main" {
  name         = "${var.name_prefix}-main"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"
  tags         = local.tags

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # 잡·할당량 기록은 ttl이 지나면 지운다 (바로 지워지지 않아 코드에서도 확인한다)
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# ---------- S3: 업로드 원본, 결과 ----------

resource "aws_s3_bucket" "files" {
  for_each = toset(["uploads", "outputs"])
  bucket   = "${var.name_prefix}-${each.key}-${random_id.suffix.hex}"
  tags     = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  for_each = aws_s3_bucket.files
  bucket   = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "files" {
  for_each = aws_s3_bucket.files
  bucket   = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "files" {
  for_each = aws_s3_bucket.files
  bucket   = each.value.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# 원본과 결과는 1일 후 만료 (만료는 다음 자정 UTC 기준으로 비동기 처리된다)
resource "aws_s3_bucket_lifecycle_configuration" "files" {
  for_each = aws_s3_bucket.files
  bucket   = each.value.id

  rule {
    id     = "expire-after-1-day"
    status = "Enabled"

    filter {}

    expiration {
      days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "tls_only" {
  for_each = aws_s3_bucket.files

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value.arn, "${each.value.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "files" {
  for_each = aws_s3_bucket.files
  bucket   = each.value.id
  policy   = data.aws_iam_policy_document.tls_only[each.key].json

  depends_on = [aws_s3_bucket_public_access_block.files]
}

# 브라우저가 presigned POST로 바로 올린다
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.files["uploads"].id

  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = [var.site_origin]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

# 결과는 서명 주소로 받는다. 아이폰 공유 화면과 인앱 브라우저 저장은 누르는 순간 파일이 있어야 해서
# 화면이 결과를 미리 받아 둘 수 있게 화면 주소에서의 GET만 연다 (ADR-034)
resource "aws_s3_bucket_cors_configuration" "outputs" {
  bucket = aws_s3_bucket.files["outputs"].id

  cors_rule {
    allowed_methods = ["GET"]
    allowed_origins = [var.site_origin]
    max_age_seconds = 3600
  }
}

# ---------- 비밀값 (SSM SecureString) ----------
# IP 해시 솔트, CloudFront만 API를 부를 수 있게 하는 오리진 확인 값

resource "random_password" "secret" {
  for_each = toset(["ip-salt", "origin-verify"])
  length   = 48
  special  = false
}

resource "aws_ssm_parameter" "secret" {
  for_each = random_password.secret
  name     = "/${replace(var.name_prefix, "-", "/")}/${each.key}"
  type     = "SecureString"
  value    = each.value.result
  tags     = local.tags
}

# ---------- Lambda ----------

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
    sid       = "Jobs"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.main.arn]
  }

  # presigned POST는 이 역할의 권한으로 서명된다
  # PutObject는 presigned POST 서명용, GetObject·ListBucket은 업로드가 끝났는지 확인(HeadObject)용.
  # ListBucket이 없으면 없는 객체에 404 대신 403이 온다
  statement {
    sid       = "Uploads"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.files["uploads"].arn}/in/*"]
  }

  statement {
    sid       = "UploadsList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.files["uploads"].arn]
  }

  statement {
    sid       = "Queue"
    actions   = ["sqs:SendMessage"]
    resources = [var.queue_arn]
  }

  # 결과 내려받기 서명 주소
  statement {
    sid       = "Downloads"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.files["outputs"].arn}/out/*"]
  }

  statement {
    sid       = "Secrets"
    actions   = ["ssm:GetParameters"]
    resources = [for p in aws_ssm_parameter.secret : p.arn]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "api"
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
      TABLE_NAME         = aws_dynamodb_table.main.name
      UPLOADS_BUCKET     = aws_s3_bucket.files["uploads"].bucket
      OUTPUTS_BUCKET     = aws_s3_bucket.files["outputs"].bucket
      QUEUE_URL          = var.queue_url
      SALT_PARAM         = aws_ssm_parameter.secret["ip-salt"].name
      ORIGIN_PARAM       = aws_ssm_parameter.secret["origin-verify"].name
      DAILY_JOB_LIMIT    = tostring(var.daily_job_limit)
      DAILY_UPLOAD_LIMIT = tostring(var.daily_upload_limit)
      NODE_OPTIONS       = "--enable-source-maps"
    }
  }

  depends_on = [aws_iam_role_policy.api, aws_cloudwatch_log_group.api]
}

# ---------- HTTP API ----------

resource "aws_apigatewayv2_api" "api" {
  name          = local.fn
  protocol_type = "HTTP"
  tags          = local.tags
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  for_each  = toset(["POST /api/uploads", "POST /api/jobs", "GET /api/jobs/{id}"])
  api_id    = aws_apigatewayv2_api.api.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags

  default_route_settings {
    throttling_rate_limit  = var.throttle_rate
    throttling_burst_limit = var.throttle_burst
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
