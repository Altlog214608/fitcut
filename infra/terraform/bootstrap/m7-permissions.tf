# M7(운영 고도화): CloudWatch 알람·대시보드와 알림 이메일 (docs/ARCHITECTURE.md 관측성, ADR-046).
# - SNS 주제와 이메일 구독은 여기서 만든다. 이메일은 커밋하지 않는 terraform.tfvars(alert_email)에만 있다
# - envs/dev는 주제를 이름으로 찾아(data.aws_sns_topic) 알람을 연결한다
# 무료 플랜 안: 알람 지표 10개, 대시보드 3개, 사용자 지정 지표 10개, SNS 이메일 월 1,000건

locals {
  cw_alarms     = "arn:aws:cloudwatch:${local.region}:${local.account}:alarm:${local.p}-*"
  cw_dashboards = "arn:aws:cloudwatch::${local.account}:dashboard/${local.p}-*"
  monitoring_reads = [
    "cloudwatch:DescribeAlarms",
    "cloudwatch:GetDashboard",
    "cloudwatch:ListDashboards",
    "cloudwatch:ListTagsForResource",
    "logs:DescribeMetricFilters",
    "sns:GetTopicAttributes",
    "sns:ListTagsForResource",
    "sns:ListTopics",
  ]
}

resource "aws_sns_topic" "alerts" {
  name = "fitcut-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------- plan 역할: 읽기 ----------

data "aws_iam_policy_document" "plan_m7" {
  statement {
    sid       = "ReadMonitoring"
    actions   = local.monitoring_reads
    resources = ["*"]
  }
}

resource "aws_iam_policy" "plan_m7" {
  name        = "fitcut-github-plan-m7"
  description = "GitHub Actions plan role: read CloudWatch alarms, dashboards, metric filters and the alert topic (M7)"
  policy      = data.aws_iam_policy_document.plan_m7.json
}

resource "aws_iam_role_policy_attachment" "plan_m7" {
  role       = aws_iam_role.plan.name
  policy_arn = aws_iam_policy.plan_m7.arn
}

# ---------- deploy 역할 ----------

data "aws_iam_policy_document" "deploy_m7" {
  statement {
    sid       = "ReadMonitoring"
    actions   = local.monitoring_reads
    resources = ["*"]
  }

  statement {
    sid       = "Alarms"
    actions   = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource"]
    resources = [local.cw_alarms]
  }

  statement {
    sid       = "Dashboards"
    actions   = ["cloudwatch:PutDashboard", "cloudwatch:DeleteDashboards"]
    resources = [local.cw_dashboards]
  }

  statement {
    sid     = "MetricFilters"
    actions = ["logs:PutMetricFilter", "logs:DeleteMetricFilter"]
    # 일부 로그 API는 log-group ARN 끝에 :*가 붙은 모양을 확인한다
    resources = concat(local.log_groups, [for g in local.log_groups : "${g}:*"])
  }
}

resource "aws_iam_policy" "deploy_m7" {
  name        = "fitcut-github-deploy-m7"
  description = "GitHub Actions deploy role: manage fitcut-dev CloudWatch alarms, dashboards and log metric filters (M7)"
  policy      = data.aws_iam_policy_document.deploy_m7.json
}

resource "aws_iam_role_policy_attachment" "deploy_m7" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy_m7.arn
}
