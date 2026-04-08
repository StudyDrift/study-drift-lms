terraform {
  required_version = ">= 1.5.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }

  # HCP Terraform / Terraform Cloud remote state.
  #
  # Organization: must already exist at https://app.terraform.io (create one with "New organization" if needed).
  # Set the org slug in ONE of these ways (they must match exactly — case-sensitive):
  #   • export TF_CLOUD_ORGANIZATION="your-slug"   # slug is the segment in /app/<slug>/workspaces
  #   • or uncomment and set `organization` below (then CI can omit TF_CLOUD_ORGANIZATION if you prefer).
  #
  # If init fails with "organization ... not found": wrong slug, org not created yet, or API token user is not
  # a member of that org. Create a user API token under Account settings → Tokens (app.terraform.io).
  cloud {
    # organization = "your-terraform-cloud-org-slug"
    workspaces {
      name = "lextures-demo"
    }
  }
}

provider "digitalocean" {
  # Reads DIGITALOCEAN_TOKEN from the environment. With Terraform Cloud REMOTE execution, set that variable
  # on the workspace (sensitive) or switch execution mode to Local — see terraform.tfvars.example.
}
