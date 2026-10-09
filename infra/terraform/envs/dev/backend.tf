terraform {
  backend "s3" {
    # TODO: bootstrap을 적용한 뒤 `terraform -chdir=infra/terraform/bootstrap output -raw state_bucket` 값으로 바꾼다.
    bucket       = "fitcut-tfstate-PENDING"
    key          = "envs/dev/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
