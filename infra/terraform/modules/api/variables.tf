variable "name_prefix" {
  description = "리소스 이름 접두사 (예: fitcut-dev). deploy 역할은 이 접두사로만 리소스를 만들 수 있다"
  type        = string
}

variable "component" {
  type    = string
  default = "api"
}

variable "lambda_zip" {
  description = "esbuild로 묶은 services/api를 담은 zip 경로"
  type        = string
}

variable "lambda_zip_hash" {
  description = "zip의 base64 SHA-256 (코드가 바뀔 때만 함수를 갱신)"
  type        = string
}

variable "workload_boundary_arn" {
  description = "bootstrap이 만든 워크로드 권한 경계 (ADR-030)"
  type        = string
}

variable "site_origin" {
  description = "업로드 버킷 CORS에 허용할 웹 주소 (https://...)"
  type        = string
}

variable "daily_job_limit" {
  description = "IP 해시별 하루 잡 만들기 횟수"
  type        = number
  default     = 20
}

variable "daily_upload_limit" {
  description = "IP 해시별 하루 업로드 수 (서울 자정 기준)"
  type        = number
  default     = 20
}

variable "queue_url" {
  description = "워커 큐. POST /api/jobs가 잡을 넣는다 (ADR-033)"
  type        = string
}

variable "queue_arn" {
  type = string
}

variable "throttle_rate" {
  description = "API 전체 초당 요청 수 상한 (WAF 대신, ADR-030)"
  type        = number
  default     = 10
}

variable "throttle_burst" {
  type    = number
  default = 20
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "events_queue_url" {
  description = "사용 이벤트 큐. POST /api/events와 잡 이벤트를 넣는다 (modules/events)"
  type        = string
}

variable "events_queue_arn" {
  type = string
}

variable "events_throttle_rate" {
  description = "POST /api/events 초당 요청 수 상한"
  type        = number
  default     = 5
}
