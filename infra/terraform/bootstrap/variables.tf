variable "github_repository" {
  description = "OIDC로 역할을 맡을 수 있는 GitHub 저장소 (owner/name)"
  type        = string
  default     = "Altlog214608/fitcut"
}

variable "alert_email" {
  description = "AWS Budgets 알림을 받을 이메일. 공개 저장소이므로 terraform.tfvars(커밋 안 함)에 둔다."
  type        = string
  sensitive   = true
}

variable "monthly_budget_usd" {
  description = "월 예산(USD). 실제 비용 50%·100%, 예측 비용 100%에서 알린다."
  type        = number
  default     = 20
}

variable "managed_bucket_prefix" {
  description = "배포 역할이 만들고 관리할 수 있는 S3 버킷 이름 접두사"
  type        = string
  default     = "fitcut-dev-"
}
