variable "name_prefix" {
  type = string
}

variable "component" {
  type    = string
  default = "worker"
}

variable "image_tag" {
  description = "ECR 이미지 태그. CI가 services/worker와 잠금 파일 내용으로 만든다 (scripts/worker-image-tag.sh)"
  type        = string
}

variable "workload_boundary_arn" {
  type = string
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "uploads_bucket" {
  type = string
}

variable "uploads_bucket_arn" {
  type = string
}

variable "outputs_bucket" {
  type = string
}

variable "outputs_bucket_arn" {
  type = string
}

variable "memory_mb" {
  description = "메모리(=CPU). 측정해서 정한다 (ADR-002)"
  type        = number
  default     = 2048
}

variable "timeout_seconds" {
  type    = number
  default = 600
}

variable "max_concurrency" {
  description = "동시에 도는 워커 수 상한 (SQS 이벤트 소스 최대 동시 실행, 2~1000)"
  type        = number
  default     = 2
}

variable "bench_memory_mb" {
  description = "메모리별 시간·비용 측정용 함수 (같은 이미지, 큐 연결 없음). 측정이 끝나면 비운다 (ADR-002)"
  type        = list(number)
  default     = []
}

variable "log_retention_days" {
  type    = number
  default = 14
}
