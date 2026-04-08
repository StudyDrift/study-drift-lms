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
    error_message = <<-EOT
      ssh_public_key must be non-empty.

      Remote execution: set Terraform variable ssh_public_key on the workspace to your public key (e.g. ssh-ed25519 AAAA...).

      Local execution / GitHub Actions: set secret DEMO_SSH_PUBLIC_KEY (passed as TF_VAR_ssh_public_key). If the workspace still has Terraform variable ssh_public_key defined as an empty string, delete that variable or set it to the real key—an empty workspace variable overrides TF_VAR from CI.
    EOT
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
