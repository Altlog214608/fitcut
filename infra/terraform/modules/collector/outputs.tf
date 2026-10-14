output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "task_family" {
  value = aws_ecs_task_definition.collector.family
}

output "task_definition_arn_prefix" {
  description = "RunTask 권한용 (모든 리비전)"
  value       = "arn:aws:ecs:${local.region}:${data.aws_caller_identity.current.account_id}:task-definition/${aws_ecs_task_definition.collector.family}:*"
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "subnet_ids" {
  value = aws_subnet.public[*].id
}

output "security_group_id" {
  value = aws_security_group.task.id
}

output "repository_url" {
  value = aws_ecr_repository.collector.repository_url
}

output "chat_bucket" {
  value = aws_s3_bucket.chat.bucket
}

output "chat_bucket_arn" {
  value = aws_s3_bucket.chat.arn
}

output "analysis_queue_url" {
  value = aws_sqs_queue.analysis.url
}

output "analysis_queue_arn" {
  value = aws_sqs_queue.analysis.arn
}

output "chat_dlq_name" {
  value = aws_sqs_queue.dlq.name
}

output "analysis_dlq_name" {
  value = aws_sqs_queue.analysis_dlq.name
}

output "sink_function_name" {
  value = aws_lambda_function.sink.function_name
}

output "analysis_function_name" {
  value = aws_lambda_function.analysis.function_name
}
