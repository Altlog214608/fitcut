# 사용 이벤트 수집: API·워커 → SQS → 배치 Lambda(최대 5분씩) → S3 analytics (gzip JSON Lines, 날짜 파티션)
# 무료 플랜이라 Firehose 대신 이 경로를 쓴다 (ADR-030, docs/ADMIN.md 파이프라인). Glue·Athena는 M4.

locals {
  tags = { Component = var.component }
  fn   = "${var.name_prefix}-events"
}

resource "random_id" "suffix" {
  byte_length = 4
}

# ---------- S3 analytics ----------

resource "aws_s3_bucket" "analytics" {
  bucket = "${var.name_prefix}-analytics-${random_id.suffix.hex}"
  tags   = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "analytics" {
  bucket = aws_s3_bucket.analytics.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "analytics" {
  bucket = aws_s3_bucket.analytics.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "analytics" {
  bucket = aws_s3_bucket.analytics.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# 사용 이벤트는 12개월 보관 (docs/ADMIN.md)
resource "aws_s3_bucket_lifecycle_configuration" "analytics" {
  bucket = aws_s3_bucket.analytics.id

  rule {
    id     = "expire-events"
    status = "Enabled"

    filter {
      prefix = "events/"
    }

    expiration {
      days = var.retention_days
    }
  }

  rule {
    id     = "abort-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "tls_only" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.analytics.arn, "${aws_s3_bucket.analytics.arn}/*"]

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

resource "aws_s3_bucket_policy" "analytics" {
  bucket     = aws_s3_bucket.analytics.id
  policy     = data.aws_iam_policy_document.tls_only.json
  depends_on = [aws_s3_bucket_public_access_block.analytics]
}

# ---------- SQS ----------

resource "aws_sqs_queue" "dlq" {
  name                      = "${local.fn}-dlq"
  message_retention_seconds = 14 * 24 * 60 * 60
  sqs_managed_sse_enabled   = true
  tags                      = local.tags
}

resource "aws_sqs_queue" "events" {
  name = local.fn
  # 배치 창(최대 5분) + 함수 시간보다 넉넉하게
  visibility_timeout_seconds = var.batch_window_seconds + var.timeout_seconds * 6
  message_retention_seconds  = 4 * 24 * 60 * 60
  sqs_managed_sse_enabled    = true
  tags                       = local.tags

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })
}

# ---------- 배치 Lambda ----------

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "events" {
  name                 = local.fn
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda.json
  permissions_boundary = var.workload_boundary_arn
  tags                 = local.tags
}

data "aws_iam_policy_document" "events" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.events.arn}:*"]
  }

  statement {
    sid       = "Queue"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
    resources = [aws_sqs_queue.events.arn]
  }

  statement {
    sid       = "WriteEvents"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.analytics.arn}/events/*"]
  }
}

resource "aws_iam_role_policy" "events" {
  name   = "events"
  role   = aws_iam_role.events.id
  policy = data.aws_iam_policy_document.events.json
}

resource "aws_cloudwatch_log_group" "events" {
  name              = "/aws/lambda/${local.fn}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "events" {
  function_name    = local.fn
  role             = aws_iam_role.events.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = var.lambda_zip
  source_code_hash = var.lambda_zip_hash
  memory_size      = 256
  timeout          = var.timeout_seconds
  tags             = local.tags

  environment {
    variables = {
      ANALYTICS_BUCKET = aws_s3_bucket.analytics.bucket
      NODE_OPTIONS     = "--enable-source-maps"
    }
  }

  depends_on = [aws_iam_role_policy.events, aws_cloudwatch_log_group.events]
}

# 최대 5분 또는 1000개씩 모아 부른다 (S3 객체 수를 줄인다). 동시 실행은 2까지 (계정 한도 10, ADR-030)
resource "aws_lambda_event_source_mapping" "events" {
  event_source_arn                   = aws_sqs_queue.events.arn
  function_name                      = aws_lambda_function.events.arn
  batch_size                         = 1000
  maximum_batching_window_in_seconds = var.batch_window_seconds
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 2
  }
}
