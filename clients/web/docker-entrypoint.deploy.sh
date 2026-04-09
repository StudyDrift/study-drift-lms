#!/bin/sh
set -e
CERT_DIR="/etc/nginx/certs"
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
  # Self-signed cert: works with Cloudflare SSL "Full" (not "Full (strict)").
  # For Full (strict), replace these files with a Cloudflare Origin Certificate or Let's Encrypt.
  openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -subj "/CN=demo.lextures.com" \
    -addext "subjectAltName=DNS:demo.lextures.com" 2>/dev/null \
  || openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -subj "/CN=demo.lextures.com"
fi
exec nginx -g "daemon off;"
