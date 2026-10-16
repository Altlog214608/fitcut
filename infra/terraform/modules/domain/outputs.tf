output "zone_id" {
  value = aws_route53_zone.this.zone_id
}

output "name_servers" {
  description = "가비아 네임서버 설정에 넣을 값"
  value       = aws_route53_zone.this.name_servers
}

output "certificate_arn" {
  value = aws_acm_certificate.site.arn
}
