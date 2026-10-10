# M2(서버리스 잡 처리)부터 쓰는 서비스 권한 (ADR-018, ADR-030).
# - plan 역할: 읽기만
# - deploy 역할: fitcut-dev-* 이름의 리소스만 만들고 바꾼다
# - deploy 역할이 만드는 IAM 역할(Lambda·Fargate용)에는 권한 경계를 반드시 붙이게 한다.
#   경계 밖의 권한(예: 관리자 정책)을 붙여도 실제로는 쓸 수 없어서, CI가 권한을 키우는 길이 막힌다.
# 역할 하나에 붙는 인라인 정책은 크기 한도가 작아 관리형 정책으로 나눠 붙인다.

variable "managed_name_prefix" {
  description = "deploy 역할이 만들고 관리할 수 있는 리소스 이름 접두사 (Lambda, DynamoDB, IAM 역할 등)"
  type        = string
  default     = "fitcut-dev"
}

variable "managed_ssm_path" {
  description = "deploy 역할과 워크로드가 쓸 수 있는 SSM 파라미터 경로"
  type        = string
  default     = "/fitcut/dev/"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.region
  p       = var.managed_name_prefix

  lambda_functions = "arn:aws:lambda:${local.region}:${local.account}:function:${local.p}-*"
  dynamodb_tables  = "arn:aws:dynamodb:${local.region}:${local.account}:table/${local.p}-*"
  iam_roles        = "arn:aws:iam::${local.account}:role/${local.p}-*"
  ssm_params       = "arn:aws:ssm:${local.region}:${local.account}:parameter${var.managed_ssm_path}*"
  sqs_queues       = "arn:aws:sqs:${local.region}:${local.account}:${local.p}-*"
  event_rules      = "arn:aws:events:${local.region}:${local.account}:rule/${local.p}-*"
  ecr_repos        = "arn:aws:ecr:${local.region}:${local.account}:repository/${local.p}-*"
  log_groups = [
    "arn:aws:logs:${local.region}:${local.account}:log-group:/aws/lambda/${local.p}-*",
    "arn:aws:logs:${local.region}:${local.account}:log-group:/ecs/${local.p}-*",
  ]
  api_gateway = "arn:aws:apigateway:${local.region}::/*"
}

# ---------- 워크로드 권한 경계 ----------
# Lambda·Fargate 역할이 가질 수 있는 최대 권한. 실제 권한은 env 쪽에서 함수별로 더 좁게 준다.

data "aws_iam_policy_document" "workload_boundary" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [for g in local.log_groups : "${g}:*"]
  }

  statement {
    sid = "DynamoDB"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
      "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:ConditionCheckItem",
    ]
    resources = [local.dynamodb_tables, "${local.dynamodb_tables}/index/*"]
  }

  statement {
    sid = "S3Objects"
    actions = [
      "s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListBucket",
    ]
    resources = [local.managed_bucket_arn, "${local.managed_bucket_arn}/*"]
  }

  statement {
    sid = "SQS"
    actions = [
      "sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage",
      "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility",
    ]
    resources = [local.sqs_queues]
  }

  statement {
    sid       = "SSMRead"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [local.ssm_params]
  }

  statement {
    sid       = "DecryptSSMOnly"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${local.region}.amazonaws.com"]
    }
  }

  statement {
    sid = "ECRPull"
    actions = [
      "ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "RunWorkerTasks"
    actions   = ["ecs:RunTask", "ecs:DescribeTasks", "ecs:StopTask"]
    resources = ["*"]
    condition {
      test     = "ArnLike"
      variable = "ecs:cluster"
      values   = ["arn:aws:ecs:${local.region}:${local.account}:cluster/${local.p}*"]
    }
  }

  statement {
    sid       = "PassWorkloadRoles"
    actions   = ["iam:PassRole"]
    resources = [local.iam_roles]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_policy" "workload_boundary" {
  name        = "${local.p}-workload-boundary"
  description = "Max permissions for fitcut dev Lambda and Fargate roles created by CI"
  policy      = data.aws_iam_policy_document.workload_boundary.json
}

# ---------- plan 역할: 읽기 ----------

data "aws_iam_policy_document" "plan_m2" {
  statement {
    sid       = "ReadServerless"
    actions   = ["lambda:Get*", "lambda:List*", "apigateway:GET", "sqs:ListQueues", "events:List*", "events:Describe*", "logs:DescribeLogGroups", "ssm:DescribeParameters", "dynamodb:ListTables", "ecr:DescribeRepositories"]
    resources = ["*"]
  }

  statement {
    sid       = "ReadDynamoDB"
    actions   = ["dynamodb:Describe*", "dynamodb:ListTagsOfResource"]
    resources = [local.dynamodb_tables]
  }

  statement {
    sid       = "ReadRoles"
    actions   = ["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole"]
    resources = [local.iam_roles]
  }

  statement {
    sid       = "ReadLogsSsmSqsEcr"
    actions   = ["logs:ListTagsForResource", "logs:ListTagsLogGroup", "ssm:GetParameter", "ssm:GetParameters", "ssm:ListTagsForResource", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ListQueueTags", "ecr:GetLifecyclePolicy", "ecr:GetRepositoryPolicy", "ecr:ListTagsForResource"]
    resources = concat(local.log_groups, [local.ssm_params, local.sqs_queues, local.ecr_repos])
  }
}

resource "aws_iam_policy" "plan_m2" {
  name        = "fitcut-github-plan-m2"
  description = "GitHub Actions plan role: read serverless resources (M2)"
  policy      = data.aws_iam_policy_document.plan_m2.json
}

resource "aws_iam_role_policy_attachment" "plan_m2" {
  role       = aws_iam_role.plan.name
  policy_arn = aws_iam_policy.plan_m2.arn
}

# ---------- deploy 역할: fitcut-dev-* 만들고 바꾸기 ----------

data "aws_iam_policy_document" "deploy_m2" {
  statement {
    sid       = "Lambda"
    actions   = ["lambda:*"]
    resources = [local.lambda_functions]
  }

  statement {
    sid       = "LambdaAccountWide"
    actions   = ["lambda:ListFunctions", "lambda:GetAccountSettings", "lambda:CreateEventSourceMapping", "lambda:GetEventSourceMapping", "lambda:UpdateEventSourceMapping", "lambda:DeleteEventSourceMapping", "lambda:ListEventSourceMappings", "lambda:TagResource", "lambda:ListTags"]
    resources = ["*"]
  }

  statement {
    sid       = "ApiGateway"
    actions   = ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE", "apigateway:TagResource", "apigateway:UntagResource"]
    resources = [local.api_gateway]
  }

  statement {
    sid       = "DynamoDB"
    actions   = ["dynamodb:*"]
    resources = [local.dynamodb_tables, "${local.dynamodb_tables}/index/*"]
  }

  statement {
    sid       = "DynamoDBAccountWide"
    actions   = ["dynamodb:ListTables", "dynamodb:DescribeLimits"]
    resources = ["*"]
  }

  # 역할을 만들거나 권한을 붙일 때는 권한 경계가 꼭 있어야 한다
  statement {
    sid       = "RolesWithBoundary"
    actions   = ["iam:CreateRole", "iam:PutRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PutRolePermissionsBoundary"]
    resources = [local.iam_roles]
    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.workload_boundary.arn]
    }
  }

  statement {
    sid       = "RolesManage"
    actions   = ["iam:GetRole", "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole"]
    resources = [local.iam_roles]
  }

  statement {
    sid       = "PassRolesToWorkloads"
    actions   = ["iam:PassRole"]
    resources = [local.iam_roles]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy", "logs:TagResource", "logs:UntagResource", "logs:TagLogGroup", "logs:UntagLogGroup", "logs:ListTagsForResource", "logs:ListTagsLogGroup"]
    resources = local.log_groups
  }

  statement {
    sid       = "SsmSqsEcr"
    actions   = ["ssm:PutParameter", "ssm:DeleteParameter", "ssm:GetParameter", "ssm:GetParameters", "ssm:AddTagsToResource", "ssm:RemoveTagsFromResource", "ssm:ListTagsForResource", "sqs:*", "ecr:*"]
    resources = [local.ssm_params, local.sqs_queues, local.ecr_repos]
  }

  statement {
    sid       = "AccountWideReads"
    actions   = ["logs:DescribeLogGroups", "ssm:DescribeParameters", "sqs:ListQueues", "ecr:GetAuthorizationToken", "ecr:DescribeRepositories", "events:List*", "events:Describe*"]
    resources = ["*"]
  }

  statement {
    sid       = "EventRules"
    actions   = ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets", "events:TagResource", "events:UntagResource", "events:EnableRule", "events:DisableRule"]
    resources = [local.event_rules]
  }
}

resource "aws_iam_policy" "deploy_m2" {
  name        = "fitcut-github-deploy-m2"
  description = "GitHub Actions deploy role: manage fitcut-dev serverless resources (M2)"
  policy      = data.aws_iam_policy_document.deploy_m2.json
}

resource "aws_iam_role_policy_attachment" "deploy_m2" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy_m2.arn
}

output "workload_boundary_arn" {
  description = "env 쪽 Lambda·Fargate 역할의 permissions_boundary"
  value       = aws_iam_policy.workload_boundary.arn
}
