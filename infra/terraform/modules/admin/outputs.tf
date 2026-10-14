output "user_pool_id" {
  value = aws_cognito_user_pool.admin.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}
