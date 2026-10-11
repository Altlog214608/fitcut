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
