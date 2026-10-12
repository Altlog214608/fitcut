# 채팅 수집기 (M5, docs/HIGHLIGHT.md 수집기 설계, ADR-013·040)
# - Fargate 태스크는 방송 중에만 돈다 (하이라이트 API가 RunTask). 클러스터·태스크 정의·VPC 자체는 비용이 없다
# - 전용 VPC: 퍼블릭 서브넷 2개 + 인터넷 게이트웨이. NAT Gateway를 두지 않고 태스크에 공인 IP를 붙인다
#   (공인 IPv4 $0.005/시간, 태스크가 도는 동안만)
# - 채팅 이벤트: 수집기 → SQS → 저장 Lambda(최대 60초씩) → S3 chat/ (ADR-030), 90일 보관

locals {
  tags = { Component = var.component }
  name = "${var.name_prefix}-collector"
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  region         = data.aws_region.current.region
  ssm_arn_prefix = "arn:aws:ssm:${local.region}:${data.aws_caller_identity.current.account_id}:parameter"
  azs            = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "random_id" "suffix" {
  byte_length = 4
}

# ---------- VPC (퍼블릭 서브넷만) ----------

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = local.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = local.name })
}

resource "aws_subnet" "public" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  # 공인 IP는 RunTask에서 붙인다 (서브넷 기본값으로 두지 않는다)
  map_public_ip_on_launch = false
  tags                    = merge(local.tags, { Name = "${local.name}-${local.azs[count.index]}" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${local.name}-public" })
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# 들어오는 연결은 받지 않는다. 나가는 것은 HTTPS(치지직 API·세션 소켓, AWS API, ECR)만
resource "aws_security_group" "task" {
  name        = "${local.name}-task"
  description = "Chat collector task: outbound HTTPS only"
  vpc_id      = aws_vpc.this.id
  tags        = merge(local.tags, { Name = "${local.name}-task" })
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.task.id
  description       = "HTTPS out"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
  tags              = local.tags
}

# ---------- 채팅 저장: S3 ----------

resource "aws_s3_bucket" "chat" {
  bucket = "${var.name_prefix}-chat-${random_id.suffix.hex}"
  tags   = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "chat" {
  bucket = aws_s3_bucket.chat.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "chat" {
  bucket = aws_s3_bucket.chat.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "chat" {
  bucket = aws_s3_bucket.chat.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# 채팅 원본은 90일 보관 (방송 기록 TTL과 같다, docs/ADMIN.md)
resource "aws_s3_bucket_lifecycle_configuration" "chat" {
  bucket = aws_s3_bucket.chat.id

  rule {
    id     = "expire-chat"
    status = "Enabled"

    filter {
      prefix = "chat/"
    }

    expiration {
      days = var.chat_retention_days
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
    resources = [aws_s3_bucket.chat.arn, "${aws_s3_bucket.chat.arn}/*"]

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

resource "aws_s3_bucket_policy" "chat" {
  bucket     = aws_s3_bucket.chat.id
  policy     = data.aws_iam_policy_document.tls_only.json
  depends_on = [aws_s3_bucket_public_access_block.chat]
}

# ---------- 채팅 저장: SQS ----------

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name_prefix}-chat-dlq"
  message_retention_seconds = 14 * 24 * 60 * 60
  sqs_managed_sse_enabled   = true
  tags                      = local.tags
}

resource "aws_sqs_queue" "chat" {
  name                       = "${var.name_prefix}-chat"
  visibility_timeout_seconds = var.batch_window_seconds + var.sink_timeout_seconds * 6
  message_retention_seconds  = 4 * 24 * 60 * 60
  sqs_managed_sse_enabled    = true
  tags                       = local.tags

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })
}

# ---------- 채팅 저장: Lambda ----------

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sink" {
  name                 = "${var.name_prefix}-chat-sink"
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda.json
  permissions_boundary = var.workload_boundary_arn
  tags                 = local.tags
}

data "aws_iam_policy_document" "sink" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.sink.arn}:*"]
  }

  statement {
    sid       = "Queue"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
    resources = [aws_sqs_queue.chat.arn]
  }

  statement {
    sid       = "WriteChat"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.chat.arn}/chat/*"]
  }
}

resource "aws_iam_role_policy" "sink" {
  name   = "chat-sink"
  role   = aws_iam_role.sink.id
  policy = data.aws_iam_policy_document.sink.json
}

resource "aws_cloudwatch_log_group" "sink" {
  name              = "/aws/lambda/${var.name_prefix}-chat-sink"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "sink" {
  function_name    = "${var.name_prefix}-chat-sink"
  role             = aws_iam_role.sink.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = var.sink_zip
  source_code_hash = var.sink_zip_hash
  memory_size      = 256
  timeout          = var.sink_timeout_seconds
  tags             = local.tags

  environment {
    variables = {
      CHAT_BUCKET  = aws_s3_bucket.chat.bucket
      NODE_OPTIONS = "--enable-source-maps"
    }
  }

  depends_on = [aws_iam_role_policy.sink, aws_cloudwatch_log_group.sink]
}

# 최대 60초 또는 1000개씩. 동시 실행 2 (계정 한도 10, ADR-030)
resource "aws_lambda_event_source_mapping" "sink" {
  event_source_arn                   = aws_sqs_queue.chat.arn
  function_name                      = aws_lambda_function.sink.arn
  batch_size                         = 1000
  maximum_batching_window_in_seconds = var.batch_window_seconds
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 2
  }
}

# ---------- ECR (이미지는 CI가 올린다) ----------

resource "aws_ecr_repository" "collector" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
  tags                 = local.tags

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "collector" {
  repository = aws_ecr_repository.collector.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep last 3 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 3 }
      action       = { type = "expire" }
    }]
  })
}

# ---------- ECS ----------

# Container Insights는 끈다 (지표당 비용)
resource "aws_ecs_cluster" "this" {
  name = local.name
  tags = local.tags

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "task" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

data "aws_iam_policy_document" "assume_ecs_tasks" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# 실행 역할: 이미지 받기, 로그 쓰기 (ECS 에이전트가 쓴다)
resource "aws_iam_role" "execution" {
  name                 = "${local.name}-execution"
  assume_role_policy   = data.aws_iam_policy_document.assume_ecs_tasks.json
  permissions_boundary = var.workload_boundary_arn
  tags                 = local.tags
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "EcrPull"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [aws_ecr_repository.collector.arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.task.arn}:*"]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "collector-execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

# 태스크 역할: 수집기 코드가 쓰는 권한
resource "aws_iam_role" "task" {
  name                 = "${local.name}-task"
  assume_role_policy   = data.aws_iam_policy_document.assume_ecs_tasks.json
  permissions_boundary = var.workload_boundary_arn
  tags                 = local.tags
}

data "aws_iam_policy_document" "task" {
  # 방송 기록(BCAST#) 상태·횟수, 연결 정보 확인, 수집 중 표시 해제
  statement {
    sid       = "Table"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [var.table_arn]
  }

  statement {
    sid       = "ClientSecret"
    actions   = ["ssm:GetParameter"]
    resources = ["${local.ssm_arn_prefix}${var.chzzk_secret_param}"]
  }

  # 토큰 갱신 후 바로 저장한다 (리프레시 토큰은 일회용)
  statement {
    sid       = "StreamerTokens"
    actions   = ["ssm:GetParameter", "ssm:PutParameter"]
    resources = ["${local.ssm_arn_prefix}${var.token_prefix}chzzk/*"]
  }

  statement {
    sid       = "SsmKey"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${local.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "ChatQueue"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.chat.arn]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "collector-task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# 가장 작은 Fargate 크기 (0.25 vCPU, 0.5GB, arm64). 서울 기준 약 $0.0114/시간 + 공인 IP $0.005/시간
resource "aws_ecs_task_definition" "collector" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  tags                     = local.tags

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name        = "collector"
    image       = "${aws_ecr_repository.collector.repository_url}:${var.image_tag}"
    essential   = true
    stopTimeout = 30
    environment = [
      { name = "TABLE_NAME", value = var.table_name },
      { name = "QUEUE_URL", value = aws_sqs_queue.chat.url },
      { name = "TOKEN_PREFIX", value = var.token_prefix },
      { name = "CHZZK_CLIENT_ID", value = var.chzzk_client_id },
      { name = "CHZZK_SECRET_PARAM", value = var.chzzk_secret_param },
      { name = "MAX_MINUTES", value = tostring(var.max_minutes) },
      { name = "IDLE_MINUTES", value = tostring(var.idle_minutes) },
      { name = "NODE_OPTIONS", value = "--enable-source-maps" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.task.name
        awslogs-region        = local.region
        awslogs-stream-prefix = "collector"
      }
    }
  }])
}
