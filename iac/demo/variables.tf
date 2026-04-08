variable "region" {
  type        = string
  description = "DigitalOcean region slug (e.g. nyc1, sfo3, lon1)."
  default     = "nyc1"
}

variable "droplet_name" {
  type        = string
  description = "Hostname for the Droplet."
  default     = "lextures-demo"
}

variable "droplet_size" {
  type        = string
  description = "Droplet plan slug (e.g. s-1vcpu-1gb for Basic shared 1 vCPU / 1 GiB)."
  default     = "s-1vcpu-1gb"
}

variable "droplet_image" {
  type        = string
  description = "OS image slug (Ubuntu LTS recommended)."
  default     = "ubuntu-24-04-x64"
}

variable "ssh_key_ids" {
  type        = list(string)
  description = "Optional. SSH public key IDs on your DigitalOcean account for console access. Leave empty if you do not want keys on the Droplet (DigitalOcean can email a root password instead)."
  default     = []
}

variable "ghcr_image_prefix" {
  type        = string
  description = "Lowercase GHCR image prefix without a trailing slash, e.g. ghcr.io/mygithubuser (must match images pushed by CI)."
}

variable "postgres_password" {
  type        = string
  sensitive   = true
  description = "Postgres password for the demo stack (written to the Droplet .env by cloud-init)."
}

variable "jwt_secret" {
  type        = string
  sensitive   = true
  description = "JWT signing secret for the API (written to the Droplet .env by cloud-init)."
}

variable "openrouter_api_key" {
  type        = string
  sensitive   = true
  description = "Optional OpenRouter API key; use empty string to disable."
  default     = ""
}

variable "tags" {
  type        = list(string)
  description = "Optional tags applied to the Droplet."
  default     = ["lextures", "demo"]
}

variable "ipv6" {
  type        = bool
  description = "Enable a public IPv6 address on the Droplet."
  default     = true
}
