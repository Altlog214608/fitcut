data "aws_caller_identity" "current" {}

locals {
  # bootstrap이 만든 워크로드 권한 경계 (ADR-030). plan 역할은 bootstrap 상태를 읽을 수 없어서 이름으로 만든다
  workload_boundary_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/fitcut-dev-workload-boundary"
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
  events_queue_url      = module.events.queue_url
  events_queue_arn      = module.events.queue_arn
}
