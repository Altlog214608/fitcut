output "zone_id" {
  value = aws_route53_zone.this.zone_id
}

output "name_servers" {
  description = "가비아 네임서버 설정에 넣을 값"
  value       = aws_route53_zone.this.name_servers
}

output "certificate_arn" {
  description = "검증이 끝난 인증서 ARN (CloudFront용)"
  value       = aws_acm_certificate_validation.site.certificate_arn
}

output "site_names" {
  description = "CloudFront에 붙일 도메인"
  value       = [var.domain_name, "www.${var.domain_name}"]
}
