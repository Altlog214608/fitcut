output "state_bucket" {
  description = "envs/*/backend.tf의 bucket 값"
  value       = aws_s3_bucket.state.bucket
}

output "plan_role_arn" {
  description = "GitHub 저장소 변수 AWS_PLAN_ROLE_ARN"
  value       = aws_iam_role.plan.arn
}

output "deploy_role_arn" {
  description = "GitHub 저장소 변수 AWS_DEPLOY_ROLE_ARN"
  value       = aws_iam_role.deploy.arn
}
