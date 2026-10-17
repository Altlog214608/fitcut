variable "domain_name" {
  description = "사이트 도메인 (예: koicut.com). www.도메인도 같이 붙는다."
  type        = string
}

variable "component" {
  description = "Component 태그 값"
  type        = string
  default     = "domain"
}

variable "site" {
  description = "koicut.com·www가 가리킬 CloudFront 배포. null이면 별칭 기록을 만들지 않는다 (1단계)."
  type = object({
    domain_name    = string
    hosted_zone_id = string
  })
  default = null
}

variable "apex_txt" {
  description = "koicut.com TXT 기록 (검색 엔진 소유 확인 등). 비어 있으면 만들지 않는다."
  type        = list(string)
  default     = []
}
