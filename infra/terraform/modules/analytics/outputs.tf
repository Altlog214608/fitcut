output "workgroup" {
  value = aws_athena_workgroup.main.name
}

output "database" {
  value = aws_glue_catalog_database.main.name
}

output "aggregate_function" {
  value = aws_lambda_function.aggregate.function_name
}
