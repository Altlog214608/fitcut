variable "name_prefix" {
  type = string
}

variable "component" {
  type    = string
  default = "analytics"
}

variable "analytics_bucket" {
  description = "사용 이벤트 버킷 (modules/events)"
  type        = string
}

variable "analytics_bucket_arn" {
  type = string
}

variable "table_name" {
  description = "집계를 쓸 DynamoDB 테이블 (STATS#<날짜>)"
  type        = string
}

variable "table_arn" {
  type = string
}

variable "lambda_zip" {
  type = string
}

variable "lambda_zip_hash" {
  type = string
}

variable "workload_boundary_arn" {
  type = string
}

variable "scan_limit_bytes" {
  description = "쿼리 하나가 읽을 수 있는 최대 바이트 (넘으면 Athena가 멈춘다). 1GB"
  type        = number
  default     = 1073741824
}

variable "log_retention_days" {
  type    = number
  default = 14
}

# 사용 이벤트 열 (packages/shared/src/events.ts, 서버 잡·링크 이벤트). 없는 필드는 NULL
variable "columns" {
  type = map(string)
  default = {
    name           = "string"
    source         = "string"
    ts             = "bigint"
    receivedat     = "bigint"
    sessionid      = "string"
    appversion     = "string"
    tool           = "string"
    kind           = "string"
    mime           = "string"
    sizebucket     = "string"
    width          = "int"
    height         = "int"
    durationsec    = "double"
    presetid       = "string"
    query          = "string"
    format         = "string"
    count          = "int"
    sizebytes      = "bigint"
    elapsedms      = "bigint"
    code           = "string"
    devicetype     = "string"
    os             = "string"
    browser        = "string"
    referrerdomain = "string"
    lang           = "string"
    platform       = "string"
    videoid        = "string"
    jobid          = "string"
    type           = "string"
    inputsize      = "bigint"
    worker         = "string"
    processingms   = "bigint"
    estcostusd     = "double"
    errorcode      = "string"
  }
}
