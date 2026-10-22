# 정적 웹: S3(비공개) + CloudFront(OAC). 버킷은 CloudFront를 통해서만 읽을 수 있다.

locals {
  tags = { Component = var.component }
}

resource "random_id" "suffix" {
  byte_length = 4
}

# ---------- S3 ----------

resource "aws_s3_bucket" "web" {
  bucket = "${var.name_prefix}-web-${random_id.suffix.hex}"
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.web]
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.web.arn, "${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.web]
}

# ---------- CloudFront ----------

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = aws_s3_bucket.web.bucket
  description                       = "${var.name_prefix} web bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# SPA 경로 처리: 확장자가 없는 경로는 /index.html로 바꾼다. 검색용으로 따로 만든 페이지(/photo 등)는
# 그 페이지의 HTML(/photo.html, 제목·설명·canonical이 다름)로 바꾼다 (apps/web/src/seo/pages.ts).
# 403·404 오류 응답을 index.html로 돌리는 방식은 진짜 오류까지 가리므로 쓰지 않는다.
resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.name_prefix}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Redirect to the canonical host, rewrite extensionless paths to /index.html"
  publish = true
  # 주소를 하나로 모은다 (광고·검색·쿠키가 한 주소에 쌓이게, ADR-051). 쿼리 값은 받은 그대로(인코딩된 채) 붙인다
  code = <<-EOT
    var CANONICAL = ${jsonencode(var.canonical_host)};
    var SEO_PAGES = ${jsonencode(var.seo_pages)};

    function query(qs) {
      var parts = [];
      for (var key in qs) {
        var values = qs[key].multiValue || [qs[key]];
        for (var i = 0; i < values.length; i++) {
          parts.push(values[i].value === '' ? key : key + '=' + values[i].value);
        }
      }
      return parts.length ? '?' + parts.join('&') : '';
    }

    function handler(event) {
      var request = event.request;
      var host = request.headers.host ? request.headers.host.value : '';
      if (CANONICAL && host !== CANONICAL) {
        return {
          statusCode: 301,
          statusDescription: 'Moved Permanently',
          headers: { location: { value: 'https://' + CANONICAL + request.uri + query(request.querystring) } },
        };
      }
      var lastSegment = request.uri.substring(request.uri.lastIndexOf('/') + 1);
      if (lastSegment.indexOf('.') === -1) {
        var path = request.uri.replace(/\/+$/, '');
        request.uri = SEO_PAGES.indexOf(path) !== -1 ? path + '.html' : '/index.html';
      }
      return request;
    }
  EOT
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# API로 보낼 것: 요청한 사람 주소(IP 해시 할당량용), 본문 형식, 쿼리 문자열. Host는 보내지 않는다(API Gateway 주소를 써야 함)
resource "aws_cloudfront_origin_request_policy" "api" {
  count   = var.api == null ? 0 : 1
  name    = "${var.name_prefix}-api"
  comment = "Forward viewer address and content type to the HTTP API"

  # fitcut_s: 스트리머 세션, fitcut_oauth: 치지직 로그인 state (M5). 둘 다 HttpOnly, Path=/api/streamer
  cookies_config {
    cookie_behavior = "whitelist"
    cookies {
      items = ["fitcut_s", "fitcut_oauth"]
    }
  }

  headers_config {
    header_behavior = "whitelist"
    headers {
      # x-admin-token: 관리자 API의 Cognito 토큰. Authorization은 오리진 요청 정책으로 보낼 수 없어 따로 둔다
      # x-delete-token: 보관한 작업을 지우는 열쇠 (F16)
      items = ["CloudFront-Viewer-Address", "Content-Type", "Accept", "x-admin-token", "x-delete-token"]
    }
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "${var.name_prefix} web"
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  default_root_object = "index.html"
  price_class         = var.price_class
  aliases             = var.aliases
  tags                = local.tags

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  dynamic "origin" {
    for_each = var.api == null ? [] : [var.api]
    content {
      origin_id   = "api"
      domain_name = origin.value.domain

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }

      custom_header {
        name  = "x-origin-verify"
        value = origin.value.origin_verify
      }
    }
  }

  # /api/*는 캐시하지 않고 API로 보낸다. SPA 경로 바꾸기 함수는 붙이지 않는다
  dynamic "ordered_cache_behavior" {
    for_each = var.api == null ? [] : [1]
    content {
      path_pattern             = "/api/*"
      target_origin_id         = "api"
      viewer_protocol_policy   = "https-only"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = true
      cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = aws_cloudfront_origin_request_policy.api[0].id
    }
  }

  # 캐시 기간은 객체의 Cache-Control을 따른다: 해시가 붙은 assets/는 1년, index.html은 no-cache (deploy.yml)
  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # 내 도메인이 있으면 SNI 방식 ACM 인증서 (전용 IP 방식은 월 $600이라 쓰지 않는다)
  viewer_certificate {
    cloudfront_default_certificate = var.certificate_arn == null
    acm_certificate_arn            = var.certificate_arn
    ssl_support_method             = var.certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.certificate_arn == null ? null : "TLSv1.2_2021"
  }
}
