output "droplet_id" {
  description = "DigitalOcean Droplet ID."
  value       = digitalocean_droplet.demo.id
}

output "droplet_urn" {
  description = "Uniform resource name for the Droplet."
  value       = digitalocean_droplet.demo.urn
}

output "ipv4_address" {
  description = "Public IPv4 address."
  value       = digitalocean_droplet.demo.ipv4_address
}

output "ipv6_address" {
  description = "Public IPv6 address (empty if ipv6 is disabled)."
  value       = digitalocean_droplet.demo.ipv6_address
}
