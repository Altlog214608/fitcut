# 운영 지표: CloudWatch 대시보드 하나와 실패 알람 (docs/ARCHITECTURE.md 관측성, ADR-046).
# 무료 플랜 안에서만 쓴다: 알람 지표 10개 중 8개(실패율 2 + 대기열 4 + Lambda 오류 1 + API 5xx 1),
# 대시보드 3개 중 1개, 사용자 지정 지표 10개 중 1개(로그 지표 필터 JobsFailed).

locals {
  tags      = { Component = var.component }
  region    = data.aws_region.current.region
  namespace = "FitCut"
}

data "aws_region" "current" {}

data "aws_sns_topic" "alerts" {
  name = var.alerts_topic_name
}

# ---------- 잡 실패 수 (워커 로그) ----------
# 워커는 ffmpeg·S3 같은 서버 쪽 실패만 "job failed"로 남긴다. 사용자 입력 문제(InputError)는 세지 않는다.
# 배치 크기가 1이라 워커 호출 수 ≈ 처리한 잡 수다.

resource "aws_cloudwatch_log_metric_filter" "jobs_failed" {
  name           = "${var.name_prefix}-jobs-failed"
  log_group_name = var.worker_log_group_name
  pattern        = "\"job failed\""

  metric_transformation {
    name          = "JobsFailed"
    namespace     = local.namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

# ---------- 알람 ----------

resource "aws_cloudwatch_metric_alarm" "job_failure_rate" {
  alarm_name          = "${var.name_prefix}-job-failure-rate"
  alarm_description   = "1시간 동안 서버 쪽 잡 실패가 3개 이상이고 실패율이 ${var.job_failure_rate_percent}%를 넘었어요. 워커 로그의 \"job failed\"를 확인하세요."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.job_failure_rate_percent
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [data.aws_sns_topic.alerts.arn]
  ok_actions          = [data.aws_sns_topic.alerts.arn]
  tags                = local.tags

  metric_query {
    id          = "rate"
    expression  = "IF(failed >= 3, 100 * failed / MAX([failed, jobs]), 0)"
    label       = "잡 실패율 (%)"
    return_data = true
  }

  metric_query {
    id = "failed"
    metric {
      namespace   = local.namespace
      metric_name = aws_cloudwatch_log_metric_filter.jobs_failed.metric_transformation[0].name
      period      = 3600
      stat        = "Sum"
    }
  }

  metric_query {
    id = "jobs"
    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Invocations"
      dimensions  = { FunctionName = var.worker_function_name }
      period      = 3600
      stat        = "Sum"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  for_each = var.dlq_names

  alarm_name          = "${each.key}-messages"
  alarm_description   = "${each.value}: 처리하지 못한 메시지가 실패 대기열에 쌓였어요. 원인을 고친 뒤 다시 보내거나 지우세요."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.key }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [data.aws_sns_topic.alerts.arn]
  ok_actions          = [data.aws_sns_topic.alerts.arn]
  tags                = local.tags
}

# 계정 전체 Lambda 오류 (함수 차원 없는 지표 하나로 모든 함수를 본다. 어느 함수인지는 대시보드에서)
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.name_prefix}-lambda-errors"
  alarm_description   = "15분 동안 Lambda 오류가 3번 이상 났어요. 대시보드의 함수별 오류에서 어느 함수인지 확인하세요."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = [data.aws_sns_topic.alerts.arn]
  ok_actions          = [data.aws_sns_topic.alerts.arn]
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name_prefix}-api-5xx"
  alarm_description   = "15분 동안 API 5xx 응답이 5번 이상이에요. API Lambda 로그를 확인하세요."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = var.api_id }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = [data.aws_sns_topic.alerts.arn]
  ok_actions          = [data.aws_sns_topic.alerts.arn]
  tags                = local.tags
}

# ---------- 대시보드 ----------

locals {
  lambda = { for f in var.function_names : f => trimprefix(f, "${var.name_prefix}-") }

  widgets = [
    {
      type = "text", x = 0, y = 0, width = 24, height = 2
      properties = {
        markdown = "## FitCut ${var.name_prefix}\n쓰지 않을 때 비용 0을 목표로 한 서버리스 구성. 알람은 이메일(SNS)로 와요. 지표 정의: docs/ARCHITECTURE.md 관측성, ADR-046"
      }
    },
    {
      type = "metric", x = 0, y = 2, width = 12, height = 6
      properties = {
        title   = "잡: 처리 수와 서버 쪽 실패 (1시간)"
        region  = local.region
        stat    = "Sum"
        period  = 3600
        view    = "timeSeries"
        stacked = false
        metrics = [
          ["AWS/Lambda", "Invocations", "FunctionName", var.worker_function_name, { label = "처리한 잡" }],
          [local.namespace, "JobsFailed", { label = "서버 쪽 실패" }],
        ]
      }
    },
    {
      type = "metric", x = 12, y = 2, width = 12, height = 6
      properties = {
        title  = "워커 처리 시간 (ms, p50·p95)"
        region = local.region
        period = 3600
        view   = "timeSeries"
        metrics = [
          ["AWS/Lambda", "Duration", "FunctionName", var.worker_function_name, { stat = "p50", label = "p50" }],
          ["...", { stat = "p95", label = "p95" }],
        ]
      }
    },
    {
      type = "metric", x = 0, y = 8, width = 12, height = 6
      properties = {
        title   = "Lambda 호출 수 (함수별)"
        region  = local.region
        stat    = "Sum"
        period  = 3600
        view    = "timeSeries"
        metrics = [for f, label in local.lambda : ["AWS/Lambda", "Invocations", "FunctionName", f, { label = label }]]
      }
    },
    {
      type = "metric", x = 12, y = 8, width = 12, height = 6
      properties = {
        title   = "Lambda 오류 (함수별)"
        region  = local.region
        stat    = "Sum"
        period  = 3600
        view    = "timeSeries"
        metrics = [for f, label in local.lambda : ["AWS/Lambda", "Errors", "FunctionName", f, { label = label }]]
      }
    },
    {
      type = "metric", x = 0, y = 14, width = 12, height = 6
      properties = {
        title  = "API 요청과 오류"
        region = local.region
        stat   = "Sum"
        period = 3600
        view   = "timeSeries"
        metrics = [
          ["AWS/ApiGateway", "Count", "ApiId", var.api_id, { label = "요청" }],
          [".", "4xx", ".", ".", { label = "4xx" }],
          [".", "5xx", ".", ".", { label = "5xx" }],
        ]
      }
    },
    {
      type = "metric", x = 12, y = 14, width = 12, height = 6
      properties = {
        title  = "API 지연 (ms)"
        region = local.region
        period = 3600
        view   = "timeSeries"
        metrics = [
          ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, { stat = "p50", label = "p50" }],
          ["...", { stat = "p95", label = "p95" }],
        ]
      }
    },
    {
      type = "metric", x = 0, y = 20, width = 12, height = 6
      properties = {
        title  = "실패 대기열에 쌓인 메시지"
        region = local.region
        stat   = "Maximum"
        period = 300
        view   = "timeSeries"
        metrics = [
          for q, label in var.dlq_names : ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", q, { label = label }]
        ]
      }
    },
    {
      type = "metric", x = 12, y = 20, width = 12, height = 6
      properties = {
        title  = "워커 대기열: 가장 오래 기다린 잡 (초)"
        region = local.region
        stat   = "Maximum"
        period = 300
        view   = "timeSeries"
        metrics = [
          ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.worker_queue_name, { label = "대기 시간" }],
        ]
      }
    },
    {
      type = "alarm", x = 0, y = 26, width = 24, height = 3
      properties = {
        title = "알람"
        alarms = concat(
          [
            aws_cloudwatch_metric_alarm.job_failure_rate.arn,
            aws_cloudwatch_metric_alarm.lambda_errors.arn,
            aws_cloudwatch_metric_alarm.api_5xx.arn,
          ],
          [for a in aws_cloudwatch_metric_alarm.dlq : a.arn],
        )
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "overview" {
  dashboard_name = "${var.name_prefix}-overview"
  dashboard_body = jsonencode({ widgets = local.widgets })
}
