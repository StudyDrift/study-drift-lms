locals {
  compose_yaml = templatefile("${path.module}/templates/docker-compose.tftpl", {
    ghcr_image_prefix = var.ghcr_image_prefix
  })
}

resource "digitalocean_droplet" "demo" {
  name   = var.droplet_name
  region = var.region
  size   = var.droplet_size
  image  = var.droplet_image

  ssh_keys = var.ssh_key_ids
  ipv6     = var.ipv6
  tags     = var.tags

  monitoring = true

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    compose_yaml       = local.compose_yaml
    postgres_password  = var.postgres_password
    jwt_secret         = var.jwt_secret
    openrouter_api_key = var.openrouter_api_key
  })
}
