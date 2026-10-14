variable "name_prefix" {
  type = string
}

variable "component" {
  type    = string
  default = "monitoring"
}

variable "alerts_topic_name" {
  description = "bootstrap이 만든 알림 SNS 주제 (이메일 구독은 bootstrap에만 있다)"
  type        = string
  default     = "fitcut-alerts"
}

variable "api_id" {
  description = "HTTP API (잡·링크·하이라이트·관리자 API가 같이 씀)"
  type        = string
}

variable "worker_function_name" {
  type = string
}

variable "worker_log_group_name" {
  type = string
}

variable "worker_queue_name" {
  type = string
}

variable "function_names" {
  description = "대시보드에 호출·오류를 그릴 Lambda 함수 (워커 포함)"
  type        = list(string)
}

variable "dlq_names" {
  description = "실패한 메시지가 쌓이는 대기열. 하나라도 쌓이면 알린다 (이름 → 화면 이름)"
  type        = map(string)
}

variable "job_failure_rate_percent" {
  description = "1시간 동안 서버 쪽 잡 실패가 3개 이상이고 이 비율(%)을 넘으면 알린다. 입력 파일 문제로 실패한 잡은 세지 않는다"
  type        = number
  default     = 20
}
