resource "digitalocean_droplet" "demo" {
  name   = var.droplet_name
  region = var.region
  size   = var.droplet_size
  image  = var.droplet_image

  ssh_keys = var.ssh_key_ids
  ipv6     = var.ipv6
  tags     = var.tags

  monitoring = true
}
