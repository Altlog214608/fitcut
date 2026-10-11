# 사용 분석: S3 사용 이벤트 → Glue 테이블(파티션 투영) → Athena 워크그룹(스캔 한도) → 일별 집계 Lambda (docs/ADMIN.md)
# 집계는 매일 새벽 3시(서울) EventBridge 규칙으로 돌고, 결과는 DynamoDB STATS#<날짜>에 둔다.
# 쓰지 않을 때 비용 0: Glue 카탈로그(무료 한도 안), Athena(스캔한 만큼), Lambda.

locals {
  tags = { Component = var.component }
  fn   = "${var.name_prefix}-aggregate"
  db   = replace(var.name_prefix, "-", "_")
}

resource "random_id" "suffix" {
  byte_length = 4
}

# ---------- Athena 결과 버킷 (7일 뒤 삭제) ----------

resource "aws_s3_bucket" "results" {
  bucket = "${var.name_prefix}-athena-${random_id.suffix.hex}"
  tags   = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "results" {
  bucket = aws_s3_bucket.results.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "results" {
  bucket                  = aws_s3_bucket.results.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "results" {
  bucket = aws_s3_bucket.results.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "results" {
  bucket = aws_s3_bucket.results.id
  rule {
    id     = "expire-results"
    status = "Enabled"
    filter {}
    expiration {
      days = 7
    }
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
    resources = [aws_s3_bucket.results.arn, "${aws_s3_bucket.results.arn}/*"]
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

resource "aws_s3_bucket_policy" "results" {
  bucket     = aws_s3_bucket.results.id
  policy     = data.aws_iam_policy_document.tls_only.json
  depends_on = [aws_s3_bucket_public_access_block.results]
}

# ---------- Glue 카탈로그 ----------

resource "aws_glue_catalog_database" "main" {
  name        = local.db
  description = "FitCut usage analytics (${var.name_prefix})"
}

# gzip JSON Lines (services/events). 날짜 파티션은 투영으로 계산해 파티션을 따로 만들지 않는다
resource "aws_glue_catalog_table" "events" {
  name          = "events"
  database_name = aws_glue_catalog_database.main.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    classification                = "json"
    "projection.enabled"          = "true"
    "projection.dt.type"          = "date"
    "projection.dt.format"        = "yyyy-MM-dd"
    "projection.dt.range"         = "2026-10-01,NOW"
    "projection.dt.interval"      = "1"
    "projection.dt.interval.unit" = "DAYS"
    "storage.location.template"   = "s3://${var.analytics_bucket}/events/dt=$${dt}/"
  }

  partition_keys {
    name = "dt"
    type = "string"
  }

  storage_descriptor {
    location      = "s3://${var.analytics_bucket}/events/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        # 이벤트는 camelCase, 열 이름은 소문자 (대소문자를 가리지 않고 맞춘다)
        "case.insensitive"      = "TRUE"
        "ignore.malformed.json" = "TRUE"
      }
    }

    dynamic "columns" {
      for_each = var.columns
      content {
        name = columns.key
        type = columns.value
      }
    }
  }
}

# ---------- Athena 워크그룹 (쿼리당 스캔 한도) ----------

resource "aws_athena_workgroup" "main" {
  name          = "${var.name_prefix}-analytics"
  force_destroy = true
  tags          = local.tags

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = false
    bytes_scanned_cutoff_per_query     = var.scan_limit_bytes

    result_configuration {
      output_location = "s3://${aws_s3_bucket.results.bucket}/athena/"
      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }
}

# ---------- 일별 집계 Lambda ----------

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "aggregate" {
  name                 = local.fn
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda.json
  permissions_boundary = var.workload_boundary_arn
  tags                 = local.tags
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  glue_arn = "arn:aws:glue:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}"
}

data "aws_iam_policy_document" "aggregate" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.aggregate.arn}:*"]
  }

  statement {
    sid       = "Athena"
    actions   = ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults", "athena:StopQueryExecution", "athena:GetWorkGroup"]
    resources = [aws_athena_workgroup.main.arn]
  }

  statement {
    sid     = "Glue"
    actions = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartition", "glue:GetPartitions"]
    resources = [
      "${local.glue_arn}:catalog",
      "${local.glue_arn}:database/${aws_glue_catalog_database.main.name}",
      "${local.glue_arn}:table/${aws_glue_catalog_database.main.name}/*",
    ]
  }

  statement {
    sid       = "ReadEvents"
    actions   = ["s3:GetObject"]
    resources = ["${var.analytics_bucket_arn}/events/*"]
  }

  # Athena가 버킷 위치를 확인하고 결과를 나눠 쓴다
  statement {
    sid       = "ListBuckets"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"]
    resources = [var.analytics_bucket_arn, aws_s3_bucket.results.arn]
  }

  statement {
    sid       = "Results"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
    resources = ["${aws_s3_bucket.results.arn}/athena/*"]
  }

  statement {
    sid       = "Stats"
    actions   = ["dynamodb:PutItem"]
    resources = [var.table_arn]
  }

  statement {
    sid       = "Cost"
    actions   = ["ce:GetCostAndUsage"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "aggregate" {
  name   = "aggregate"
  role   = aws_iam_role.aggregate.id
  policy = data.aws_iam_policy_document.aggregate.json
}

resource "aws_cloudwatch_log_group" "aggregate" {
  name              = "/aws/lambda/${local.fn}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "aggregate" {
  function_name    = local.fn
  role             = aws_iam_role.aggregate.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = var.lambda_zip
  source_code_hash = var.lambda_zip_hash
  memory_size      = 256
  timeout          = 300
  tags             = local.tags

  environment {
    variables = {
      TABLE_NAME   = var.table_name
      WORKGROUP    = aws_athena_workgroup.main.name
      DATABASE     = aws_glue_catalog_database.main.name
      EVENTS_TABLE = aws_glue_catalog_table.events.name
      NODE_OPTIONS = "--enable-source-maps"
    }
  }

  depends_on = [aws_iam_role_policy.aggregate, aws_cloudwatch_log_group.aggregate]
}

# 매일 새벽 3시(서울) = 18:00 UTC
resource "aws_cloudwatch_event_rule" "daily" {
  name                = "${local.fn}-daily"
  description         = "Aggregate yesterday's usage and cost"
  schedule_expression = "cron(0 18 * * ? *)"
  tags                = local.tags
}

resource "aws_cloudwatch_event_target" "daily" {
  rule = aws_cloudwatch_event_rule.daily.name
  arn  = aws_lambda_function.aggregate.arn
}

resource "aws_lambda_permission" "daily" {
  statement_id  = "AllowDailyRule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.aggregate.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily.arn
}
