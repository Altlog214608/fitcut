terraform {
  # 처음에는 로컬 상태로 이 버킷을 만들고, 그 뒤 -migrate-state로 상태를 여기로 옮겼다 (ADR-017).
  # CI 역할은 envs/* 키만 읽을 수 있어 bootstrap 상태에는 접근하지 못한다.
  backend "s3" {
    bucket       = "fitcut-tfstate-c87f4c6d"
    key          = "bootstrap/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
