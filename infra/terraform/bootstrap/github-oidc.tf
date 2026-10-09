# GitHub Actions가 장기 액세스 키 없이 OIDC로 AWS 역할을 맡는다.
# - plan 역할: 이 저장소의 PR에서만. 읽기 + 상태 잠금 파일 쓰기만 한다.
# - deploy 역할: 이 저장소의 main 브랜치에서만. M0에 필요한 S3·CloudFront만 관리한다.
#   새 서비스를 쓰는 마일스톤에서 권한을 그때그때 넓힌다 (ADR-018).

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  state_bucket_arn   = aws_s3_bucket.state.arn
  state_envs_objects = "${aws_s3_bucket.state.arn}/envs/*"
  managed_bucket_arn = "arn:aws:s3:::${var.managed_bucket_prefix}*"

  # Terraform이 S3 버킷 상태를 읽을 때 호출하는 API
  s3_bucket_read_actions = [
    "s3:ListBucket",
    "s3:GetBucket*",
    "s3:GetAccelerateConfiguration",
    "s3:GetEncryptionConfiguration",
    "s3:GetLifecycleConfiguration",
    "s3:GetReplicationConfiguration",
  ]

  cloudfront_read_actions = [
    "cloudfront:Get*",
    "cloudfront:List*",
    "cloudfront:Describe*",
  ]
}

data "aws_iam_policy_document" "github_trust" {
  for_each = {
    plan   = "repo:${var.github_repository}:pull_request"
    deploy = "repo:${var.github_repository}:ref:refs/heads/main"
  }

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [each.value]
    }
  }
}

# ---------- plan 역할 ----------

data "aws_iam_policy_document" "plan" {
  statement {
    sid       = "StateRead"
    actions   = ["s3:ListBucket", "s3:GetObject"]
    resources = [local.state_bucket_arn, local.state_envs_objects]
  }

  statement {
    sid       = "StateLock"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/envs/*.tflock"]
  }

  statement {
    sid       = "ReadManagedBuckets"
    actions   = local.s3_bucket_read_actions
    resources = [local.managed_bucket_arn]
  }

  statement {
    sid       = "ReadCloudFront"
    actions   = local.cloudfront_read_actions
    resources = ["*"]
  }
}

resource "aws_iam_role" "plan" {
  name               = "fitcut-github-plan"
  description        = "GitHub Actions PR에서 terraform plan"
  assume_role_policy = data.aws_iam_policy_document.github_trust["plan"].json
}

resource "aws_iam_role_policy" "plan" {
  name   = "terraform-plan"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan.json
}

# ---------- deploy 역할 ----------

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "StateReadWrite"
    actions   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [local.state_bucket_arn, local.state_envs_objects]
  }

  statement {
    sid = "ManageBuckets"
    actions = concat(local.s3_bucket_read_actions, [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:PutBucket*",
      "s3:DeleteBucketPolicy",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
    ])
    resources = [local.managed_bucket_arn]
  }

  statement {
    sid       = "SyncWebObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.managed_bucket_arn}/*"]
  }

  statement {
    sid = "ManageCloudFront"
    actions = concat(local.cloudfront_read_actions, [
      "cloudfront:CreateDistribution",
      "cloudfront:UpdateDistribution",
      "cloudfront:DeleteDistribution",
      "cloudfront:TagResource",
      "cloudfront:UntagResource",
      "cloudfront:CreateOriginAccessControl",
      "cloudfront:UpdateOriginAccessControl",
      "cloudfront:DeleteOriginAccessControl",
      "cloudfront:CreateFunction",
      "cloudfront:UpdateFunction",
      "cloudfront:DeleteFunction",
      "cloudfront:PublishFunction",
      "cloudfront:CreateInvalidation",
    ])
    resources = ["*"]
  }
}

resource "aws_iam_role" "deploy" {
  name               = "fitcut-github-deploy"
  description        = "GitHub Actions main 브랜치에서 terraform apply와 웹 배포"
  assume_role_policy = data.aws_iam_policy_document.github_trust["deploy"].json
}

resource "aws_iam_role_policy" "deploy" {
  name   = "terraform-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
