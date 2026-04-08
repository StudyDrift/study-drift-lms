terraform {
  required_version = ">= 1.5"

  # HCP Terraform: state and (by default) runs. Omit `organization` and set
  # TF_CLOUD_ORGANIZATION (e.g. from GitHub Actions). Create workspace `lextures-demo`
  # in that org before the first apply.
  cloud {
    workspaces {
      name = "lextures-demo"
    }
  }

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.34"
    }
  }
}
