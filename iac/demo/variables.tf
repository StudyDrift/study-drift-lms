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
  description = "SSH public key IDs or fingerprints already uploaded to your DigitalOcean account (https://cloud.digitalocean.com/account/security)."
  default     = []
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
