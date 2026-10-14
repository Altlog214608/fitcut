output "dashboard_name" {
  value = aws_cloudwatch_dashboard.overview.dashboard_name
}

output "alarm_names" {
  value = concat(
    [
      aws_cloudwatch_metric_alarm.job_failure_rate.alarm_name,
      aws_cloudwatch_metric_alarm.lambda_errors.alarm_name,
      aws_cloudwatch_metric_alarm.api_5xx.alarm_name,
    ],
    [for a in aws_cloudwatch_metric_alarm.dlq : a.alarm_name],
  )
}
