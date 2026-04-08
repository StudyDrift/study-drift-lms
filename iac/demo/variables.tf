# Matches common Terraform Cloud workspace Terraform variable naming. If empty, the provider
# still uses the DIGITALOCEAN_TOKEN environment variable (e.g. TFC env var or local shell).
variable "DIGITALOCEAN_TOKEN" {
  description = "DigitalOcean API token. Optional when the same value is only set as an environment variable."
  type        = string
  sensitive   = true
  default     = ""
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
