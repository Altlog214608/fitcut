output "queue_url" {
  value = aws_sqs_queue.events.id
}

output "queue_arn" {
  value = aws_sqs_queue.events.arn
}

output "analytics_bucket" {
  value = aws_s3_bucket.analytics.bucket
}

output "analytics_bucket_arn" {
  value = aws_s3_bucket.analytics.arn
}

output "dlq_name" {
  value = aws_sqs_queue.dlq.name
}

output "function_name" {
  value = aws_lambda_function.events.function_name
}
