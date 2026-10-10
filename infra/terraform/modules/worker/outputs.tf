output "repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "function_name" {
  value = aws_lambda_function.worker.function_name
}

output "queue_url" {
  value = aws_sqs_queue.jobs.id
}

output "dlq_url" {
  value = aws_sqs_queue.dlq.id
}
