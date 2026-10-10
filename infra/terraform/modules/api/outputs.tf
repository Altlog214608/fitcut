output "api_domain" {
  description = "CloudFront 오리진으로 쓸 HTTP API 주소 (https:// 제외)"
  value       = replace(aws_apigatewayv2_api.api.api_endpoint, "https://", "")
}

output "origin_verify" {
  description = "CloudFront가 API로 보낼 오리진 확인 헤더 값"
  value       = random_password.secret["origin-verify"].result
  sensitive   = true
}

output "table_name" {
  value = aws_dynamodb_table.main.name
}

output "uploads_bucket" {
  value = aws_s3_bucket.files["uploads"].bucket
}

output "outputs_bucket" {
  value = aws_s3_bucket.files["outputs"].bucket
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}
