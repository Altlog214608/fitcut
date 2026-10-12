variable "name_prefix" {
  type = string
}

variable "component" {
  type    = string
  default = "collector"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "image_tag" {
  type        = string
  description = "수집기 이미지 태그. CI: scripts/collector-image-tag.sh"
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "token_prefix" {
  type        = string
  description = "스트리머 토큰 SSM 경로 앞부분 (예: /fitcut/dev/streamer/)"
}

variable "chzzk_client_id" {
  type = string
}

variable "chzzk_secret_param" {
  type = string
}

variable "max_minutes" {
  type        = number
  default     = 480
  description = "수집 최대 실행 시간 (분). 상시 실행을 막는 안전장치"
}

variable "idle_minutes" {
  type        = number
  default     = 30
  description = "이벤트가 이만큼 없으면 방송이 끝난 것으로 보고 멈춘다 (분)"
}

variable "chat_retention_days" {
  type    = number
  default = 90
}

variable "batch_window_seconds" {
  type    = number
  default = 60
}

variable "sink_timeout_seconds" {
  type    = number
  default = 30
}

variable "sink_zip" {
  type = string
}

variable "sink_zip_hash" {
  type = string
}

variable "workload_boundary_arn" {
  type = string
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "analysis_zip" {
  type = string
}

variable "analysis_zip_hash" {
  type = string
}

variable "analysis_timeout_seconds" {
  type    = number
  default = 120
}
