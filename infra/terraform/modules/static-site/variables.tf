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

variable "api" {
  description = <<-EOT
    /api/* 요청을 보낼 HTTP API (같은 주소로 부르므로 CORS가 필요 없다).
    origin_verify는 CloudFront가 붙여 보내는 오리진 확인 헤더 값이다. API는 이 값이 없으면 거절한다.
  EOT
  type = object({
    domain        = string
    origin_verify = string
  })
  default   = null
  sensitive = true
}

variable "aliases" {
  description = "CloudFront에 붙일 내 도메인 (예: koicut.com, www.koicut.com). 비우면 cloudfront.net 주소만 쓴다."
  type        = list(string)
  default     = []
}

variable "certificate_arn" {
  description = "aliases를 덮는 us-east-1 ACM 인증서 (검증이 끝난 것). aliases를 쓰면 필요하다."
  type        = string
  default     = null
}

variable "canonical_host" {
  description = "이 주소가 아닌 호스트(www, cloudfront.net)로 온 화면 요청을 여기로 301 보낸다. null이면 보내지 않는다. /api/*는 그대로 둔다."
  type        = string
  default     = null
}

variable "seo_pages" {
  description = "따로 HTML을 만든 검색용 경로 (/photo → /photo.html). apps/web/src/seo/pages.ts와 같은 목록"
  type        = list(string)
  default     = ["/photo", "/gif", "/audio", "/rotate", "/highlight", "/privacy"]
}
