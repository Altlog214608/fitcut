# M5(방송 하이라이트)부터 쓰는 서비스 권한 (docs/HIGHLIGHT.md, ADR-013·040).
# - ECS(Fargate): 채팅 수집기. 클러스터·태스크 정의만 두고, 태스크는 방송 중에만 돈다
# - EC2(VPC): 수집기 전용 VPC. 퍼블릭 서브넷 + 인터넷 게이트웨이만 쓴다 (NAT Gateway 없음, 고정 비용 없음)
# 워크로드 권한 경계의 ecs:RunTask·iam:PassRole(ecs-tasks)은 m2-permissions.tf에 이미 있다.
# 만드는 EC2 리소스에는 Project=fitcut 태그가 붙는다(envs/dev default_tags). 바꾸기·지우기는 이 태그가 있는 것만 연다.

locals {
  ecs_clusters  = "arn:aws:ecs:${local.region}:${local.account}:cluster/${local.p}-*"
  ecs_task_defs = "arn:aws:ecs:${local.region}:${local.account}:task-definition/${local.p}-*:*"
}

# ---------- plan 역할: 읽기 ----------

data "aws_iam_policy_document" "plan_m5" {
  statement {
    sid       = "ReadEcsEc2"
    actions   = ["ecs:Describe*", "ecs:List*", "ec2:Describe*"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "plan_m5" {
  name        = "fitcut-github-plan-m5"
  description = "GitHub Actions plan role: read collector ECS and VPC resources (M5)"
  policy      = data.aws_iam_policy_document.plan_m5.json
}

resource "aws_iam_role_policy_attachment" "plan_m5" {
  role       = aws_iam_role.plan.name
  policy_arn = aws_iam_policy.plan_m5.arn
}

# ---------- deploy 역할 ----------

data "aws_iam_policy_document" "deploy_m5" {
  statement {
    sid       = "EcsClusters"
    actions   = ["ecs:CreateCluster", "ecs:DeleteCluster", "ecs:DescribeClusters", "ecs:UpdateCluster", "ecs:UpdateClusterSettings", "ecs:PutClusterCapacityProviders", "ecs:TagResource", "ecs:UntagResource", "ecs:ListTagsForResource"]
    resources = [local.ecs_clusters]
  }

  # 태스크 정의 등록·조회는 리소스 단위로 막을 수 없다 (ECS 서비스 권한 참조)
  statement {
    sid       = "EcsTaskDefinitions"
    actions   = ["ecs:RegisterTaskDefinition", "ecs:DeregisterTaskDefinition", "ecs:DescribeTaskDefinition", "ecs:ListTaskDefinitions", "ecs:ListClusters"]
    resources = ["*"]
  }

  statement {
    sid       = "EcsTagTaskDefinitions"
    actions   = ["ecs:TagResource", "ecs:UntagResource", "ecs:ListTagsForResource"]
    resources = [local.ecs_task_defs]
  }

  # 처음 클러스터를 만들 때 ECS 서비스 연결 역할이 없으면 만든다
  statement {
    sid       = "EcsServiceLinkedRole"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["arn:aws:iam::${local.account}:role/aws-service-role/ecs.amazonaws.com/AWSServiceRoleForECS"]
    condition {
      test     = "StringEquals"
      variable = "iam:AWSServiceName"
      values   = ["ecs.amazonaws.com"]
    }
  }

  statement {
    sid       = "Ec2Read"
    actions   = ["ec2:Describe*"]
    resources = ["*"]
  }

  # 만들기는 ARN이 없어서 계정 범위로 연다. 빈 VPC·서브넷·게이트웨이 자체는 비용이 없다
  statement {
    sid       = "Ec2Create"
    actions   = ["ec2:CreateVpc", "ec2:CreateSubnet", "ec2:CreateInternetGateway", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup"]
    resources = ["*"]
  }

  # 태그는 만들 때 붙이는 것, 또는 이미 fitcut 태그가 있는 리소스에만
  statement {
    sid       = "Ec2TagOnCreate"
    actions   = ["ec2:CreateTags"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "ec2:CreateAction"
      values   = ["CreateVpc", "CreateSubnet", "CreateInternetGateway", "CreateRouteTable", "CreateSecurityGroup"]
    }
  }

  statement {
    sid = "Ec2ManageTagged"
    actions = [
      "ec2:CreateTags", "ec2:DeleteTags",
      "ec2:DeleteVpc", "ec2:ModifyVpcAttribute",
      "ec2:DeleteSubnet", "ec2:ModifySubnetAttribute",
      "ec2:AttachInternetGateway", "ec2:DetachInternetGateway", "ec2:DeleteInternetGateway",
      "ec2:CreateRoute", "ec2:DeleteRoute", "ec2:ReplaceRoute", "ec2:DeleteRouteTable",
      "ec2:AssociateRouteTable", "ec2:DisassociateRouteTable",
      "ec2:DeleteSecurityGroup",
      "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupEgress",
      "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress",
      "ec2:ModifySecurityGroupRules", "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = ["fitcut"]
    }
  }

  # 보안 그룹 규칙(security-group-rule)은 따로 태그가 없어서, 위 조건 대신 규칙 리소스로 연다
  statement {
    sid       = "Ec2SecurityGroupRules"
    actions   = ["ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupEgress", "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress", "ec2:CreateTags"]
    resources = ["arn:aws:ec2:${local.region}:${local.account}:security-group-rule/*"]
  }
}

resource "aws_iam_policy" "deploy_m5" {
  name        = "fitcut-github-deploy-m5"
  description = "GitHub Actions deploy role: manage fitcut-dev collector ECS and VPC resources (M5)"
  policy      = data.aws_iam_policy_document.deploy_m5.json
}

resource "aws_iam_role_policy_attachment" "deploy_m5" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy_m5.arn
}
