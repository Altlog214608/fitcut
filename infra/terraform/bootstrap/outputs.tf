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

output "alerts_topic_arn" {
  description = "알람 알림 SNS 주제 (envs/dev는 이름 fitcut-alerts로 찾는다)"
  value       = aws_sns_topic.alerts.arn
}
