variable "name_prefix" {
  description = "리소스 이름 접두사 (예: fitcut-dev). 배포 역할의 버킷 권한 접두사와 맞아야 한다."
  type        = string
}

variable "component" {
  description = "Component 태그 값"
  type        = string
  default     = "web"
}

variable "price_class" {
  description = "CloudFront 가격 등급. PriceClass_200부터 한국 엣지가 포함된다."
  type        = string
  default     = "PriceClass_200"
}
