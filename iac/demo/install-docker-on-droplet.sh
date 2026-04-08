#!/usr/bin/env bash
# One-off fix when cloud-init did not install Docker (e.g. Droplet created before user_data was fixed).
# Run as root: bash install-docker-on-droplet.sh
# Log: /var/log/lextures-docker-install.log
set -euo pipefail
exec >> /var/log/lextures-docker-install.log 2>&1
echo "=== manual docker install $(date -Is) ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
rm -f /tmp/get-docker.sh
systemctl enable --now docker
docker info
