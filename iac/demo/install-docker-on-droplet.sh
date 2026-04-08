#!/usr/bin/env bash
# One-off fix when a Droplet was created before cloud-init installed Docker, or cloud-init failed.
# Run as root on the VM: bash install-docker-on-droplet.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io docker-compose-plugin
systemctl enable --now docker
docker info
