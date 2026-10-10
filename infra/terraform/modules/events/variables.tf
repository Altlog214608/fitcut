variable "name_prefix" {
  type = string
}

variable "component" {
  type    = string
  default = "events"
}

variable "lambda_zip" {
  description = "services/events 빌드 결과 zip 경로"
  type        = string
}

variable "lambda_zip_hash" {
  type = string
}

variable "workload_boundary_arn" {
  type = string
}

variable "retention_days" {
  description = "사용 이벤트 보관 기간 (docs/ADMIN.md: 12개월)"
  type        = number
  default     = 365
}

variable "batch_window_seconds" {
  description = "배치 Lambda가 모으는 최대 시간 (SQS 이벤트 소스 최대 300초)"
  type        = number
  default     = 300
}

variable "timeout_seconds" {
  type    = number
  default = 60
}

variable "log_retention_days" {
  type    = number
  default = 14
}
