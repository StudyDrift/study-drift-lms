output "droplet_public_ipv4" {
  description = "Public IPv4 address of the demo droplet."
  value       = digitalocean_droplet.demo.ipv4_address
}

output "ssh_root" {
  description = "Example SSH command as root (for debugging)."
  value       = "ssh root@${digitalocean_droplet.demo.ipv4_address}"
}
