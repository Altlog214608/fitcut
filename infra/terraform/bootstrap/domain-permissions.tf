# 내 도메인 koicut.com (ADR-051): Route 53 호스팅 영역, CloudFront용 ACM 인증서(us-east-1), DNS 기록.
# - 호스팅 영역 ID와 인증서 ARN은 만들 때 정해져서 미리 좁힐 수 없다. 대신 계정·리전·리소스 종류로 좁힌다
# - CloudFront에 인증서를 붙이는 것은 기존 cloudfront:UpdateDistribution 권한으로 한다
# 비용: 호스팅 영역 월 $0.50 (사용자 확인 2026-10-16). 인증서와 CloudFront 별칭 조회는 무료

locals {
  acm_certificates = "arn:aws:acm:us-east-1:${local.account}:certificate/*"
  route53_reads = [
    "route53:GetHostedZone",
    "route53:ListHostedZones",
    "route53:ListHostedZonesByName",
    "route53:ListResourceRecordSets",
    "route53:ListTagsForResource",
    "route53:GetChange",
    "route53:GetDNSSEC",
    "acm:DescribeCertificate",
    "acm:GetCertificate",
    "acm:ListCertificates",
    "acm:ListTagsForCertificate",
  ]
}

# ---------- plan 역할: 읽기 ----------

data "aws_iam_policy_document" "plan_domain" {
  statement {
    sid       = "ReadDomain"
    actions   = local.route53_reads
    resources = ["*"]
  }
}

resource "aws_iam_policy" "plan_domain" {
  name        = "fitcut-github-plan-domain"
  description = "GitHub Actions plan role: read the Route 53 zone and ACM certificate for the custom domain"
  policy      = data.aws_iam_policy_document.plan_domain.json
}

resource "aws_iam_role_policy_attachment" "plan_domain" {
  role       = aws_iam_role.plan.name
  policy_arn = aws_iam_policy.plan_domain.arn
}

# ---------- deploy 역할 ----------

data "aws_iam_policy_document" "deploy_domain" {
  statement {
    sid       = "ReadDomain"
    actions   = local.route53_reads
    resources = ["*"]
  }

  statement {
    sid       = "CreateZone"
    actions   = ["route53:CreateHostedZone"]
    resources = ["*"]
  }

  statement {
    sid = "ManageZone"
    actions = [
      "route53:ChangeResourceRecordSets",
      "route53:ChangeTagsForResource",
      "route53:UpdateHostedZoneComment",
      "route53:DeleteHostedZone",
    ]
    resources = ["arn:aws:route53:::hostedzone/*"]
  }

  statement {
    sid       = "RequestCertificate"
    actions   = ["acm:RequestCertificate", "acm:AddTagsToCertificate"]
    resources = ["*"]
  }

  statement {
    sid       = "ManageCertificate"
    actions   = ["acm:DeleteCertificate", "acm:AddTagsToCertificate", "acm:RemoveTagsFromCertificate"]
    resources = [local.acm_certificates]
  }
}

resource "aws_iam_policy" "deploy_domain" {
  name        = "fitcut-github-deploy-domain"
  description = "GitHub Actions deploy role: manage the Route 53 zone, DNS records and ACM certificate for the custom domain"
  policy      = data.aws_iam_policy_document.deploy_domain.json
}

resource "aws_iam_role_policy_attachment" "deploy_domain" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy_domain.arn
}
