variable "ssh_public_key" {
  description = "Public SSH key allowed to log in as root on the droplet (must match the private key used in Deploy Demo)."
  type        = string
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
