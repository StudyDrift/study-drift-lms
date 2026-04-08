terraform {
  required_version = ">= 1.5.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }

  # Remote state for CI (GitHub Actions). Set TF_TOKEN and TF_CLOUD_ORGANIZATION (or set organization here).
  cloud {
    workspaces {
      name = "lextures-demo"
    }
  }
}

provider "digitalocean" {
  # Set DIGITALOCEAN_TOKEN in the environment (see terraform.tfvars.example).
}
