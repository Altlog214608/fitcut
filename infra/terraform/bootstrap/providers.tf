provider "aws" {
  region = "ap-northeast-2"

  default_tags {
    tags = {
      Project   = "fitcut"
      Env       = "shared"
      Component = "bootstrap"
    }
  }
}
