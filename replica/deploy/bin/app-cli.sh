#!/usr/bin/env bash
# Runs one of the app's command-line tools (first-owner, break-glass, ...) as the APP user, in a CLEAN environment, from root. Usage:
#   sudo ./app-cli.sh first-owner --workspace "Your Company" --name "Your Name" --email you@your-company.example
#   sudo ./app-cli.sh break-glass unlock --email you@your-company.example
# It loads /etc/taskapp/app.env as root (the app user cannot read that file), then starts node as the app user with an EMPTY environment plus only the settings the tools
# need. It does not use npm and passes no HOME, so a file the app planted in its own home folder (.npmrc, .curlrc) can never be picked up and run with these privileges.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

tool=${1:-}
case "$tool" in first-owner|break-glass) ;; *) die "usage: app-cli.sh first-owner|break-glass [options]" ;; esac
shift
ENV_FILE=${APP_ENV_FILE:-/etc/taskapp/app.env}
APP_DIR=${APP_DIR:-/opt/taskapp/current}
NODE_BIN=${NODE_BIN:-/opt/node/bin/node}
APP_USER=${APP_USER:-taskapp}
[ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE (run this as root)"
set -a; . "$ENV_FILE"; set +a
refuse_placeholders DB_PATH PUBLIC_URL

cmd=("$NODE_BIN" --no-warnings "$APP_DIR/app/cli/$tool.js" "$@")
run=(env -i PATH=/usr/bin:/bin "DB_PATH=$DB_PATH" "PUBLIC_URL=$PUBLIC_URL" "PORT=${PORT:-3000}" "${cmd[@]}")
if [ "$(id -u)" -eq 0 ]; then exec setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups --no-new-privs "${run[@]}"; fi
exec "${run[@]}"
