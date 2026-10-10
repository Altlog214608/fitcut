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
}
