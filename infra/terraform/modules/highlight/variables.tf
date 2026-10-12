variable "name_prefix" {
  type = string
}

variable "ssm_prefix" {
  type        = string
  description = "SSM 파라미터 경로 앞부분 (예: /fitcut/dev/). 워크로드 권한 경계가 허용하는 경로여야 한다"
}

variable "component" {
  type    = string
  default = "highlight"
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

variable "site_origin" {
  type        = string
  description = "https://<사이트 도메인>. 치지직 앱의 로그인 리디렉션 URL이 여기서 정해진다"
}

variable "chzzk_client_id" {
  type        = string
  description = "치지직 개발자센터 앱의 Client ID (비밀값 아님, 인증 주소에 그대로 나간다)"
}

variable "chzzk_secret_param" {
  type        = string
  description = "치지직 Client Secret을 담은 SSM SecureString 이름 (사용자가 로컬에서 넣는다)"
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

variable "collector" {
  description = "수집기 모듈 출력 (RunTask에 쓴다)"
  type = object({
    cluster_arn                = string
    task_family                = string
    task_definition_arn_prefix = string
    task_role_arn              = string
    execution_role_arn         = string
    subnet_ids                 = list(string)
    security_group_id          = string
  })
}
