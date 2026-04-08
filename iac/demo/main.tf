provider "digitalocean" {
  token = var.DIGITALOCEAN_TOKEN != "" ? var.DIGITALOCEAN_TOKEN : null
}

resource "tls_private_key" "demo" {
  algorithm = "ED25519"
}

resource "digitalocean_ssh_key" "demo" {
  name       = "${var.droplet_name}-ssh"
  public_key = tls_private_key.demo.public_key_openssh
}

resource "digitalocean_droplet" "demo" {
  name     = var.droplet_name
  region   = var.region
  size     = var.droplet_size
  image    = var.droplet_image
  ssh_keys = [digitalocean_ssh_key.demo.id]
  tags     = ["lextures", "demo"]

  user_data = file("${path.module}/cloud-init.yaml")
}

resource "digitalocean_firewall" "demo" {
  name = "${var.droplet_name}-fw"

  droplet_ids = [digitalocean_droplet.demo.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
