# 내 도메인 (ADR-051): Route 53 호스팅 영역과 CloudFront용 ACM 인증서.
# 도메인은 가비아에서 샀고, 가비아의 네임서버를 이 영역의 네임서버로 바꿔서 연결한다.
# 인증서는 DNS 검증이다. 네임서버가 바뀌기 전에는 "검증 대기"로 남아 있다가, 바뀌면 ACM이 알아서 발급한다.

# 영역을 다시 만들면 네임서버가 바뀌어 가비아 설정을 또 바꿔야 한다. 지우지 않게 막는다
resource "aws_route53_zone" "this" {
  name    = var.domain_name
  comment = "KoiCut"

  tags = {
    Component = var.component
  }

  lifecycle {
    prevent_destroy = true
  }
}

# CloudFront는 us-east-1 인증서만 쓴다 (provider 6의 리소스별 region)
resource "aws_acm_certificate" "site" {
  region                    = "us-east-1"
  domain_name               = var.domain_name
  subject_alternative_names = ["www.${var.domain_name}"]
  validation_method         = "DNS"

  tags = {
    Component = var.component
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => o
  }

  zone_id         = aws_route53_zone.this.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

# 네임서버가 바뀌어 발급이 끝난 뒤라 바로 넘어간다. CloudFront는 이 ARN을 쓴다
resource "aws_acm_certificate_validation" "site" {
  region                  = "us-east-1"
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

locals {
  site_names = var.site == null ? [] : [var.domain_name, "www.${var.domain_name}"]
  site_records = {
    for pair in setproduct(local.site_names, ["A", "AAAA"]) : "${pair[0]} ${pair[1]}" => {
      name = pair[0]
      type = pair[1]
    }
  }
}

# www 없는 주소는 CNAME을 못 쓰므로 별칭 기록. CloudFront 별칭 조회는 요금이 없다
resource "aws_route53_record" "site" {
  for_each = local.site_records

  zone_id = aws_route53_zone.this.zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = var.site.domain_name
    zone_id                = var.site.hosted_zone_id
    evaluate_target_health = false
  }
}
