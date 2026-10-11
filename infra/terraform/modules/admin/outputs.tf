output "user_pool_id" {
  value = aws_cognito_user_pool.admin.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}
