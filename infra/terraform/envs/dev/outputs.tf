output "web_bucket_name" {
  value = module.web.bucket_name
}

output "web_distribution_id" {
  value = module.web.distribution_id
}

output "web_url" {
  value = "https://${module.web.domain_name}"
}

output "api_function_name" {
  value = module.api.function_name
}

output "table_name" {
  value = module.api.table_name
}

output "worker_repository_url" {
  value = module.worker.repository_url
}

output "worker_function_name" {
  value = module.worker.function_name
}

# 화면이 로그인에 쓰는 값 (비밀이 아니다). 배포 워크플로가 웹 빌드에 넣는다
output "admin_user_pool_id" {
  value = module.admin.user_pool_id
}

output "admin_client_id" {
  value = module.admin.client_id
}
