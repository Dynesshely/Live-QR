#!/bin/sh
set -e

echo "[entrypoint] Starting QR-Live server..."
node /srv/server/index.js &

echo "[entrypoint] Starting Caddy..."
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
