output "bucket_name" {
  value = aws_s3_bucket.web.bucket
}

output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "domain_name" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "hosted_zone_id" {
  description = "Route 53 별칭 기록이 가리킬 CloudFront 영역 ID"
  value       = aws_cloudfront_distribution.web.hosted_zone_id
}
