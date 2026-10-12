# 방송 하이라이트: 스트리머 채널 연결·수집 시작/종료 API (M5, docs/HIGHLIGHT.md, ADR-015·039·040)
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

  # 세션(SESS#), 로그인 state(OAUTH#), 연결 정보(CONN#), 방송 기록(BCAST#), 하루 횟수(QUOTA#)
  statement {
    sid       = "Table"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:UpdateItem", "dynamodb:Query"]
    resources = [var.table_arn]
  }

  # 방송 수집 시작: 수집기 태스크만 이 클러스터에서 띄운다 (ADR-040)
  statement {
    sid       = "RunCollector"
    actions   = ["ecs:RunTask"]
    resources = [var.collector.task_definition_arn_prefix]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.collector.cluster_arn]
    }
  }

  statement {
    sid       = "PassCollectorRoles"
    actions   = ["iam:PassRole"]
    resources = [var.collector.task_role_arn, var.collector.execution_role_arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # 녹화 파일 멀티파트: 만들기·조각 서명·목록·합치기·크기 확인·지우기 (CompleteMultipartUpload는 PutObject 권한)
  statement {
    sid       = "Recordings"
    actions   = ["s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.recordings.arn}/rec/*"]
  }

  # 모드 B 클립 잡을 워커 큐에 넣는다 (ADR-043)
  statement {
    sid       = "WorkerQueue"
    actions   = ["sqs:SendMessage"]
    resources = [var.worker_queue_arn]
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
      CLUSTER            = var.collector.cluster_arn
      TASK_FAMILY        = var.collector.task_family
      SUBNETS            = join(",", var.collector.subnet_ids)
      SECURITY_GROUP     = var.collector.security_group_id
      RECORDINGS_BUCKET  = aws_s3_bucket.recordings.bucket
      WORKER_QUEUE_URL   = var.worker_queue_url
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
    "GET /api/streamer/broadcasts",
    "POST /api/streamer/broadcasts",
    "GET /api/streamer/broadcasts/{id}",
    "POST /api/streamer/broadcasts/{id}/stop",
    "POST /api/streamer/broadcasts/{id}/recording",
    "GET /api/streamer/broadcasts/{id}/recording",
    "DELETE /api/streamer/broadcasts/{id}/recording",
    "POST /api/streamer/broadcasts/{id}/recording/parts",
    "POST /api/streamer/broadcasts/{id}/recording/complete",
    "POST /api/streamer/broadcasts/{id}/clips",
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

# ---------- 모드 B 녹화 파일 (ADR-042) ----------
# 스트리머가 멀티파트로 올린다 (조각 32MiB, 20GB까지). 2일 뒤 지운다. 파일 이름은 저장하지 않는다

resource "random_id" "recordings" {
  byte_length = 4
}

resource "aws_s3_bucket" "recordings" {
  bucket = "${var.name_prefix}-recordings-${random_id.recordings.hex}"
  tags   = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  rule {
    id     = "expire-after-${var.recording_days}-days"
    status = "Enabled"

    filter {
      prefix = "rec/"
    }

    expiration {
      days = var.recording_days
    }

    # 다 올리지 못한 조각도 같은 날 정리한다 (조각도 저장 비용이 든다)
    abort_incomplete_multipart_upload {
      days_after_initiation = var.recording_days
    }
  }
}

# 화면이 서명 주소로 조각을 바로 올린다
resource "aws_s3_bucket_cors_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = [var.site_origin]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

data "aws_iam_policy_document" "recordings_tls_only" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.recordings.arn, "${aws_s3_bucket.recordings.arn}/*"]

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

resource "aws_s3_bucket_policy" "recordings" {
  bucket     = aws_s3_bucket.recordings.id
  policy     = data.aws_iam_policy_document.recordings_tls_only.json
  depends_on = [aws_s3_bucket_public_access_block.recordings]
}
