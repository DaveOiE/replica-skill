#!/usr/bin/env bash
# Refuses to go on unless the Node on this machine is exactly the pinned version. Run before the app and before every backup.
# NODE_VERSION_PIN comes from the settings file and must equal .nvmrc in the code folder.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"
NODE_BIN=${NODE_BIN:-/opt/node/bin/node}
APP_DIR=${APP_DIR:-/opt/taskapp/current}
[ -n "${NODE_VERSION_PIN:-}" ] || die "NODE_VERSION_PIN is not set"
[ -x "$NODE_BIN" ] || die "no Node at $NODE_BIN"
have=$("$NODE_BIN" --version)
[ "$have" = "v$NODE_VERSION_PIN" ] || die "Node is $have but this build is pinned to v$NODE_VERSION_PIN. Install the pinned version; do not change the pin without running the tests on the new one."
if [ -f "$APP_DIR/.nvmrc" ]; then
  want=$(tr -d '[:space:]' < "$APP_DIR/.nvmrc")
  [ "$want" = "$NODE_VERSION_PIN" ] || die "NODE_VERSION_PIN ($NODE_VERSION_PIN) differs from .nvmrc ($want)"
fi
log "node $have ok"
