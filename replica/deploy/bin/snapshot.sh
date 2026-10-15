#!/usr/bin/env bash
# Step 1 of a backup. Runs as the APP user (the only one that may open the live database), with no key and no credential: takes a consistent copy while the app
# keeps running, checks it (integrity, foreign keys, the audit chain), and leaves it where the backup user can read it. Usage: snapshot.sh scheduled|premigration
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

mode=${1:-}
case "$mode" in scheduled|premigration) ;; *) die "usage: snapshot.sh scheduled|premigration" ;; esac
APP_DIR=${APP_DIR:-/opt/taskapp/current}
NODE_BIN=${NODE_BIN:-/opt/node/bin/node}
SNAPSHOT_DIR=${SNAPSHOT_DIR:-/var/lib/taskapp-snapshot}
refuse_placeholders DB_PATH
[ -d "$SNAPSHOT_DIR" ] || die "no snapshot folder at $SNAPSHOT_DIR"

out="$SNAPSHOT_DIR/$mode.db"
rm -f -- "$out" "$out.partial"       # an old snapshot must never be mistaken for this one
log "snapshot ($mode): copying and checking the database"
(cd "$APP_DIR" && "$NODE_BIN" --no-warnings app/cli/backup.js snapshot --out "$out")
log "snapshot ($mode): ready"
