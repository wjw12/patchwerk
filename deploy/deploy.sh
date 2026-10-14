#!/usr/bin/env bash
# Runs on the EC2 box: pull main, build and publish the frontend, update Caddy, restart the room server.
#   ssh ubuntu@13.57.55.141 '~/patchwerk/deploy/deploy.sh'
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
bun install --frozen-lockfile
bun run build
sudo mkdir -p /var/www/patchwerk
sudo rsync -a --delete dist/ /var/www/patchwerk/

bun install --cwd server --frozen-lockfile
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
pm2 restart patchwerk-server --update-env
pm2 save >/dev/null
echo "deployed $(git rev-parse --short HEAD)"
