# M4(관리자·분석)부터 쓰는 서비스 권한 (docs/ADMIN.md, ADR-011).
# - Cognito: 관리자 로그인 (셀프 가입 끔, MFA)
# - Glue Data Catalog + Athena: S3 사용 이벤트 조회 (파티션 투영이라 파티션을 따로 만들지 않는다)
# - 일별 집계는 EventBridge 규칙으로 부른다 (M2 권한 그대로)
# 워크로드 권한 경계에 Athena·Glue 읽기·Cost Explorer 읽기를 더한 것은 m2-permissions.tf에 있다.

# ---------- plan 역할: 읽기 ----------

data "aws_iam_policy_document" "plan_m4" {
  statement {
    sid       = "ReadCognitoAthenaGlue"
    actions   = ["cognito-idp:Describe*", "cognito-idp:Get*", "cognito-idp:List*", "athena:GetWorkGroup", "athena:ListWorkGroups", "athena:ListTagsForResource", "glue:GetDatabase", "glue:GetDatabases", "glue:GetTable", "glue:GetTables", "glue:GetTags"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "plan_m4" {
  name        = "fitcut-github-plan-m4"
  description = "GitHub Actions plan role: read admin and analytics resources (M4)"
  policy      = data.aws_iam_policy_document.plan_m4.json
}

resource "aws_iam_role_policy_attachment" "plan_m4" {
  role       = aws_iam_role.plan.name
  policy_arn = aws_iam_policy.plan_m4.arn
}

# ---------- deploy 역할 ----------

data "aws_iam_policy_document" "deploy_m4" {
  # 사용자 풀은 만들기 전에는 ARN이 없어 만들기·목록만 계정 범위로 연다
  statement {
    sid       = "CognitoCreate"
    actions   = ["cognito-idp:CreateUserPool", "cognito-idp:ListUserPools", "cognito-idp:DescribeUserPoolDomain"]
    resources = ["*"]
  }

  statement {
    sid       = "CognitoManage"
    actions   = ["cognito-idp:*"]
    resources = [local.cognito_pools]
  }

  statement {
    sid       = "AthenaWorkgroups"
    actions   = ["athena:CreateWorkGroup", "athena:GetWorkGroup", "athena:UpdateWorkGroup", "athena:DeleteWorkGroup", "athena:TagResource", "athena:UntagResource", "athena:ListTagsForResource"]
    resources = [local.athena_workgroups]
  }

  statement {
    sid       = "GlueCatalog"
    actions   = ["glue:CreateDatabase", "glue:GetDatabase", "glue:UpdateDatabase", "glue:DeleteDatabase", "glue:CreateTable", "glue:GetTable", "glue:GetTables", "glue:UpdateTable", "glue:DeleteTable", "glue:TagResource", "glue:UntagResource", "glue:GetTags"]
    resources = local.glue_resources
  }
}

resource "aws_iam_policy" "deploy_m4" {
  name        = "fitcut-github-deploy-m4"
  description = "GitHub Actions deploy role: manage fitcut-dev admin and analytics resources (M4)"
  policy      = data.aws_iam_policy_document.deploy_m4.json
}

resource "aws_iam_role_policy_attachment" "deploy_m4" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy_m4.arn
}
