variable "name_prefix" {
  type = string
}

variable "component" {
  type    = string
  default = "admin"
}

variable "api_id" {
  type = string
}

variable "api_execution_arn" {
  type = string
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "origin_param_name" {
  type = string
}

variable "origin_param_arn" {
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

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "retained_bucket" {
  type        = string
  description = "보관 동의 파일 버킷 (F16)"
}

variable "retained_bucket_arn" {
  type = string
}
