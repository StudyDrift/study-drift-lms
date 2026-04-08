# Matches common Terraform Cloud workspace Terraform variable naming. If empty, the provider
# still uses the DIGITALOCEAN_TOKEN environment variable (e.g. TFC env var or local shell).
variable "DIGITALOCEAN_TOKEN" {
  description = "DigitalOcean API token. Optional when the same value is only set as an environment variable."
  type        = string
  sensitive   = true
  default     = ""
}

variable "ssh_public_key" {
  description = "Public SSH key allowed to log in as root on the droplet (must match the private key used in Deploy Demo). For HCP Terraform remote runs, set this as a Terraform variable on the workspace (TF_VAR_ssh_public_key from GitHub is not visible to remote agents)."
  type        = string

  validation {
    condition     = length(trimspace(var.ssh_public_key)) > 0
    error_message = "ssh_public_key must be non-empty. For remote execution on Terraform Cloud, add Terraform variable ssh_public_key to the workspace. For local execution (e.g. GitHub Actions with workspace execution mode Local), set TF_VAR_ssh_public_key."
  }
}

variable "droplet_name" {
  description = "Name tag for the droplet and related resources."
  type        = string
  default     = "lextures-demo"
}

variable "region" {
  description = "DigitalOcean region slug (e.g. nyc3)."
  type        = string
  default     = "nyc3"
}

variable "droplet_size" {
  description = "Droplet size slug (e.g. s-1vcpu-1gb)."
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "droplet_image" {
  description = "OS image slug for the droplet."
  type        = string
  default     = "ubuntu-22-04-x64"
}
