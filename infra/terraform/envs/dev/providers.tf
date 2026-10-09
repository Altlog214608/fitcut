provider "aws" {
  region = "ap-northeast-2"

  # Component 태그는 리소스마다 붙인다.
  default_tags {
    tags = {
      Project = "fitcut"
      Env     = "dev"
    }
  }
}
