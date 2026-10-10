# 워커: 잡 API가 업로드를 확인하고 SQS에 넣는다 → Lambda(컨테이너 이미지, ffmpeg) → outputs 버킷 (ADR-033)
# (docs/ARCHITECTURE.md 요청 흐름 3~4단계. 큰 작업을 Fargate로 보내는 분배기는 Lambda 측정 후에 붙인다, ADR-002)

locals {
  tags = { Component = var.component }
  fn   = "${var.name_prefix}-worker"
}

# ---------- ECR (이미지는 CI가 올린다) ----------

resource "aws_ecr_repository" "worker" {
  name                 = local.fn
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
  tags                 = local.tags

  image_scanning_configuration {
    scan_on_push = true
  }
}

# 저장 용량이 쌓이지 않게 최근 이미지 3개만 남긴다 (이미지 하나 약 수백 MB)
resource "aws_ecr_lifecycle_policy" "worker" {
  repository = aws_ecr_repository.worker.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep last 3 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 3 }
      action       = { type = "expire" }
    }]
  })
}

# ---------- SQS ----------

resource "aws_sqs_queue" "dlq" {
  name                      = "${local.fn}-dlq"
  message_retention_seconds = 4 * 24 * 60 * 60
  sqs_managed_sse_enabled   = true
  tags                      = local.tags
}

resource "aws_sqs_queue" "jobs" {
  name                       = local.fn
  visibility_timeout_seconds = var.timeout_seconds * 2
  message_retention_seconds  = 24 * 60 * 60
  sqs_managed_sse_enabled    = true
  tags                       = local.tags

  # 두 번 실패하면 DLQ로 (입력 문제는 워커가 failed로 끝내므로 여기까지 오지 않는다)
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 2
  })
}

# ---------- Lambda (컨테이너 이미지) ----------

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "worker" {
  name                 = local.fn
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda.json
  permissions_boundary = var.workload_boundary_arn
  tags                 = local.tags
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid     = "Logs"
    actions = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = concat(
      ["${aws_cloudwatch_log_group.worker.arn}:*"],
      [for g in aws_cloudwatch_log_group.bench : "${g.arn}:*"],
    )
  }

  statement {
    sid       = "Queue"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
    resources = [aws_sqs_queue.jobs.arn]
  }

  statement {
    sid       = "Jobs"
    actions   = ["dynamodb:UpdateItem"]
    resources = [var.table_arn]
  }

  statement {
    sid       = "ReadOriginals"
    actions   = ["s3:GetObject"]
    resources = ["${var.uploads_bucket_arn}/in/*"]
  }

  statement {
    sid       = "WriteOutputs"
    actions   = ["s3:PutObject"]
    resources = ["${var.outputs_bucket_arn}/out/*"]
  }
}

resource "aws_iam_role_policy" "worker" {
  name   = "worker"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${local.fn}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "worker" {
  function_name = local.fn
  role          = aws_iam_role.worker.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.worker.repository_url}:${var.image_tag}"
  architectures = ["arm64"]
  memory_size   = var.memory_mb
  timeout       = var.timeout_seconds
  tags          = local.tags

  # 원본(최대 500MB)과 결과를 /tmp에 둔다
  ephemeral_storage {
    size = 2048
  }

  environment {
    variables = {
      TABLE_NAME     = var.table_name
      UPLOADS_BUCKET = var.uploads_bucket
      OUTPUTS_BUCKET = var.outputs_bucket
    }
  }

  depends_on = [aws_iam_role_policy.worker, aws_cloudwatch_log_group.worker]
}

# 계정 동시 실행 한도가 10이라 예약 동시성 대신 이벤트 소스에서 상한을 건다 (ADR-030)
resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn        = aws_sqs_queue.jobs.arn
  function_name           = aws_lambda_function.worker.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = var.max_concurrency
  }
}

# ---------- 메모리별 측정 (잠깐만 둔다) ----------
# 같은 이미지·역할로 메모리만 다른 함수. 큐에 연결하지 않고 측정 스크립트가 직접 부른다.
# 쓰지 않을 때 비용은 0이고, 측정이 끝나면 bench_memory_mb를 비워 지운다 (ADR-002)

resource "aws_cloudwatch_log_group" "bench" {
  for_each          = toset([for m in var.bench_memory_mb : tostring(m)])
  name              = "/aws/lambda/${local.fn}-bench-${each.key}"
  retention_in_days = 3
  tags              = local.tags
}

resource "aws_lambda_function" "bench" {
  for_each      = toset([for m in var.bench_memory_mb : tostring(m)])
  function_name = "${local.fn}-bench-${each.key}"
  role          = aws_iam_role.worker.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.worker.repository_url}:${var.image_tag}"
  architectures = ["arm64"]
  memory_size   = tonumber(each.key)
  timeout       = var.timeout_seconds
  tags          = local.tags

  ephemeral_storage {
    size = 2048
  }

  environment {
    variables = {
      TABLE_NAME     = var.table_name
      UPLOADS_BUCKET = var.uploads_bucket
      OUTPUTS_BUCKET = var.outputs_bucket
    }
  }

  depends_on = [aws_iam_role_policy.worker, aws_cloudwatch_log_group.bench]
}
