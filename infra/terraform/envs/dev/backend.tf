terraform {
  backend "s3" {
    # bootstrap 출력값 state_bucket
    bucket       = "fitcut-tfstate-c87f4c6d"
    key          = "envs/dev/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
