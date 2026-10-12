output "redirect_uri" {
  description = "치지직 앱에 등록해야 하는 로그인 리디렉션 URL"
  value       = aws_lambda_function.api.environment[0].variables.REDIRECT_URI
}

output "token_prefix" {
  value = local.token_prefix
}
