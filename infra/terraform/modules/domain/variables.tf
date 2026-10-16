variable "domain_name" {
  description = "사이트 도메인 (예: koicut.com). www.도메인도 같이 붙는다."
  type        = string
}

variable "component" {
  description = "Component 태그 값"
  type        = string
  default     = "domain"
}
