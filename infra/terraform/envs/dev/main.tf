data "aws_caller_identity" "current" {}

locals {
  # bootstrap이 만든 워크로드 권한 경계 (ADR-030). plan 역할은 bootstrap 상태를 읽을 수 없어서 이름으로 만든다
  workload_boundary_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/fitcut-dev-workload-boundary"

  # 치지직 개발자센터 앱 (2026-10-12 등록). Client ID는 인증 주소에 그대로 나가는 공개 값이다
  chzzk_client_id    = "b0268950-e7c9-42c1-b17b-3738167aee92"
  chzzk_secret_param = "/fitcut/dev/chzzk/client-secret"
}

# services/api를 esbuild로 묶은 결과 (CI에서 plan·apply 전에 pnpm --filter @fitcut/api build)
data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../services/api/dist"
  output_path = "${path.module}/.build/api.zip"
}

data "archive_file" "events" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../services/events/dist"
  output_path = "${path.module}/.build/events.zip"
}

data "archive_file" "aggregate" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../services/admin/dist/aggregate"
  output_path = "${path.module}/.build/aggregate.zip"
}

data "archive_file" "admin_api" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../services/admin/dist/api"
  output_path = "${path.module}/.build/admin-api.zip"
}

data "archive_file" "chat_sink" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../services/highlight/dist/chat-sink"
  output_path = "${path.module}/.build/chat-sink.zip"
}

data "archive_file" "analysis" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../services/highlight/dist/analyze"
  output_path = "${path.module}/.build/analysis.zip"
}

data "archive_file" "highlight_api" {
  type        = "zip"
  source_dir  = "${path.module}/../../../../services/highlight/dist/api"
  output_path = "${path.module}/.build/highlight-api.zip"
}

module "web" {
  source = "../../modules/static-site"

  name_prefix = "fitcut-dev"
  api = {
    domain        = module.api.api_domain
    origin_verify = module.api.origin_verify
  }
}

module "api" {
  source = "../../modules/api"

  name_prefix           = "fitcut-dev"
  lambda_zip            = data.archive_file.api.output_path
  lambda_zip_hash       = data.archive_file.api.output_base64sha256
  workload_boundary_arn = local.workload_boundary_arn
  site_origin           = "https://${module.web.domain_name}"
  queue_url             = module.worker.queue_url
  queue_arn             = module.worker.queue_arn
  events_queue_url      = module.events.queue_url
  events_queue_arn      = module.events.queue_arn
}

module "events" {
  source = "../../modules/events"

  name_prefix           = "fitcut-dev"
  lambda_zip            = data.archive_file.events.output_path
  lambda_zip_hash       = data.archive_file.events.output_base64sha256
  workload_boundary_arn = local.workload_boundary_arn
}

variable "worker_image_tag" {
  description = "워커 이미지 태그. CI: scripts/worker-image-tag.sh (services/worker와 잠금 파일 내용으로 정해진다)"
  type        = string
}

module "worker" {
  source = "../../modules/worker"

  name_prefix           = "fitcut-dev"
  image_tag             = var.worker_image_tag
  workload_boundary_arn = local.workload_boundary_arn
  table_name            = module.api.table_name
  table_arn             = module.api.table_arn
  uploads_bucket        = module.api.uploads_bucket
  uploads_bucket_arn    = module.api.uploads_bucket_arn
  outputs_bucket        = module.api.outputs_bucket
  outputs_bucket_arn    = module.api.outputs_bucket_arn
  retained_bucket       = module.api.retained_bucket
  retained_bucket_arn   = module.api.retained_bucket_arn
  recordings_bucket     = module.highlight.recordings_bucket
  recordings_bucket_arn = module.highlight.recordings_bucket_arn
  events_queue_url      = module.events.queue_url
  events_queue_arn      = module.events.queue_arn
}

module "analytics" {
  source = "../../modules/analytics"

  name_prefix           = "fitcut-dev"
  analytics_bucket      = module.events.analytics_bucket
  analytics_bucket_arn  = module.events.analytics_bucket_arn
  table_name            = module.api.table_name
  table_arn             = module.api.table_arn
  lambda_zip            = data.archive_file.aggregate.output_path
  lambda_zip_hash       = data.archive_file.aggregate.output_base64sha256
  workload_boundary_arn = local.workload_boundary_arn
}

module "admin" {
  source = "../../modules/admin"

  name_prefix           = "fitcut-dev"
  api_id                = module.api.api_id
  api_execution_arn     = module.api.api_execution_arn
  table_name            = module.api.table_name
  table_arn             = module.api.table_arn
  origin_param_name     = module.api.origin_param_name
  origin_param_arn      = module.api.origin_param_arn
  retained_bucket       = module.api.retained_bucket
  retained_bucket_arn   = module.api.retained_bucket_arn
  lambda_zip            = data.archive_file.admin_api.output_path
  lambda_zip_hash       = data.archive_file.admin_api.output_base64sha256
  workload_boundary_arn = local.workload_boundary_arn
}

module "highlight" {
  source = "../../modules/highlight"

  name_prefix        = "fitcut-dev"
  ssm_prefix         = "/fitcut/dev/"
  api_id             = module.api.api_id
  api_execution_arn  = module.api.api_execution_arn
  table_name         = module.api.table_name
  table_arn          = module.api.table_arn
  origin_param_name  = module.api.origin_param_name
  origin_param_arn   = module.api.origin_param_arn
  site_origin        = "https://${module.web.domain_name}"
  chzzk_client_id    = local.chzzk_client_id
  chzzk_secret_param = local.chzzk_secret_param
  worker_queue_url   = module.worker.queue_url
  worker_queue_arn   = module.worker.queue_arn
  collector = {
    cluster_arn                = module.collector.cluster_arn
    task_family                = module.collector.task_family
    task_definition_arn_prefix = module.collector.task_definition_arn_prefix
    task_role_arn              = module.collector.task_role_arn
    execution_role_arn         = module.collector.execution_role_arn
    subnet_ids                 = module.collector.subnet_ids
    security_group_id          = module.collector.security_group_id
  }
  lambda_zip            = data.archive_file.highlight_api.output_path
  lambda_zip_hash       = data.archive_file.highlight_api.output_base64sha256
  workload_boundary_arn = local.workload_boundary_arn
}

variable "collector_image_tag" {
  description = "수집기 이미지 태그. CI: scripts/collector-image-tag.sh (services/collector·packages/chzzk·잠금 파일 내용으로 정해진다)"
  type        = string
}

module "collector" {
  source = "../../modules/collector"

  name_prefix           = "fitcut-dev"
  image_tag             = var.collector_image_tag
  table_name            = module.api.table_name
  table_arn             = module.api.table_arn
  token_prefix          = "/fitcut/dev/streamer/"
  chzzk_client_id       = local.chzzk_client_id
  chzzk_secret_param    = local.chzzk_secret_param
  sink_zip              = data.archive_file.chat_sink.output_path
  sink_zip_hash         = data.archive_file.chat_sink.output_base64sha256
  analysis_zip          = data.archive_file.analysis.output_path
  analysis_zip_hash     = data.archive_file.analysis.output_base64sha256
  workload_boundary_arn = local.workload_boundary_arn
}
