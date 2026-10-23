variable "github_oidc_subject_prefixes" {
  description = <<-EOT
    OIDC로 역할을 맡을 수 있는 GitHub 저장소의 sub 클레임 접두사 목록.
    immutable subject 형식(repo:OWNER@OWNER-ID/REPO@REPO-ID)이라 같은 이름으로 다시 만든
    다른 저장소로는 신뢰가 넘어가지 않는다 (저장소 ID가 다르다).
    저장소 이름을 fitcut → koicut으로 바꾸면서(ADR-054) 옛 이름과 새 이름을 함께 둔다.
    저장소 ID(1411410621)가 같아서 둘 다 이 저장소만 가리킨다.
    확인: gh api repos/Altlog214608/koicut/actions/oidc/customization/sub
    TODO(verify): 이름을 바꾼 뒤 실제 sub 클레임에 새 이름이 들어가는지 확인하고, 옛 이름 줄을 지운다.
  EOT
  type        = list(string)
  default = [
    "repo:Altlog214608@186117655/koicut@1411410621",
    "repo:Altlog214608@186117655/fitcut@1411410621",
  ]
}

variable "alert_email" {
  description = "AWS Budgets·CloudWatch 알람 알림을 받을 이메일. 공개 저장소이므로 terraform.tfvars(커밋 안 함)에 둔다."
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
