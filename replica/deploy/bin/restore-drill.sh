#!/usr/bin/env bash
# Restore drill: fetch a backup, restore it to a SCRATCH folder, start a throw-away copy of the app on a spare port, check it answers,
# then delete everything. It never touches the live database. Run by hand, as the service user, with a read-only credential:
#   sudo -u taskapp ./restore-drill.sh            # newest backup
#   sudo -u taskapp ./restore-drill.sh <name>     # a named one
# Settings: /etc/taskapp/taskapp.env (for BACKUP_KEY and the app) and /etc/taskapp/restore-drill.env (the read credential, scratch folder, spare port).
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

ENV_FILE=${TASKAPP_ENV_FILE:-/etc/taskapp/taskapp.env}
DRILL_ENV_FILE=${TASKAPP_DRILL_ENV_FILE:-/etc/taskapp/restore-drill.env}
for f in "$ENV_FILE" "$DRILL_ENV_FILE"; do [ -r "$f" ] || die "cannot read $f"; set -a; . "$f"; set +a; done
APP_DIR=${APP_DIR:-/opt/taskapp/current}
NODE_BIN=${NODE_BIN:-/opt/node/bin/node}
refuse_placeholders BACKUP_KEY DRILL_TOOL DRILL_SOURCE DRILL_DIR DRILL_PORT DB_PATH
case "$DRILL_TOOL" in rclone|gsutil) ;; *) die "DRILL_TOOL must be rclone or gsutil" ;; esac

# Guard rails: the scratch folder must be clearly a drill folder, nowhere near the live database, and the port must differ.
case "$DRILL_DIR" in /*drill*) ;; *) die "DRILL_DIR must be an absolute path with 'drill' in its name" ;; esac
live_dir=$(dirname "$DB_PATH")
scratch=$(realpath -m "$DRILL_DIR"); live=$(realpath -m "$live_dir")
[ "$scratch" != "/" ] || die "refusing to use / as the scratch folder"
case "$live/" in "$scratch/"*) die "the scratch folder contains the live database folder" ;; esac
case "$scratch/" in "$live/"*) die "the scratch folder is inside the live database folder" ;; esac
[ "$DRILL_PORT" != "${PORT:-3000}" ] || die "DRILL_PORT must differ from the live PORT"

want=${1:-}
mkdir -p "$scratch"; chmod 700 "$scratch"
app_pid=""
cleanup() { [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true; case "$scratch" in /*drill*) rm -rf -- "$scratch" ;; esac; }
trap cleanup EXIT

# Which backup
if [ -z "$want" ]; then
  case "$DRILL_TOOL" in
    rclone) listing=$(RCLONE_CONFIG=${DRILL_RCLONE_CONFIG:-} rclone lsf "$DRILL_SOURCE") ;;
    gsutil) listing=$(GOOGLE_APPLICATION_CREDENTIALS=${DRILL_GOOGLE_APPLICATION_CREDENTIALS:-} gsutil ls "$DRILL_SOURCE/") ;;
  esac
  best=0
  while IFS= read -r line; do
    n=$(basename "${line:-}"); [[ "$n" =~ $BACKUP_NAME_RE ]] || continue
    e=$(stamp_to_epoch "$(printf '%s' "$n" | grep -oE '[0-9]{8}T[0-9]{6}Z')") || continue
    if [ "$e" -gt "$best" ]; then best=$e; want=$n; fi
  done <<< "$listing"
  [ -n "$want" ] || die "no backups found at the destination"
fi
[[ "$want" =~ $BACKUP_NAME_RE ]] || die "that is not a backup file name"
log "drill: using $want"

# Fetch with the read credential
case "$DRILL_TOOL" in
  rclone) RCLONE_CONFIG=${DRILL_RCLONE_CONFIG:-} rclone copyto "$DRILL_SOURCE/$want" "$scratch/$want" ;;
  gsutil) GOOGLE_APPLICATION_CREDENTIALS=${DRILL_GOOGLE_APPLICATION_CREDENTIALS:-} gsutil -q cp "$DRILL_SOURCE/$want" "$scratch/$want" ;;
esac

# Restore: decrypts, checks integrity and the audit chain, and only then puts the file in place. Wrong key or damage stops here.
(cd "$APP_DIR" && npm run --silent restore -- --from "$scratch/$want" --to "$scratch/app.db") || die "DRILL FAILED: the backup did not restore"

# Start a throw-away app on the restored file and ask it for its health.
(cd "$APP_DIR" && DB_PATH="$scratch/app.db" PORT="$DRILL_PORT" PUBLIC_URL="http://127.0.0.1:$DRILL_PORT" TRUST_PROXY=false \
   exec "$NODE_BIN" --no-warnings app/server/index.js >"$scratch/app.log" 2>&1) &
app_pid=$!
ok=0
for _ in $(seq 1 40); do
  if curl -fsS -m 2 "http://127.0.0.1:$DRILL_PORT/api/v1/health" 2>/dev/null | grep -q '"ok":true'; then ok=1; break; fi
  kill -0 "$app_pid" 2>/dev/null || break
  sleep 0.5
done
[ "$ok" = 1 ] || die "DRILL FAILED: the restored copy did not start and answer. Log: $(tail -n 5 "$scratch/app.log" | tr '\n' ' ')"
log "DRILL PASSED: $want restored, passed its checks, and a throw-away app answered on port $DRILL_PORT. Scratch folder removed."
log "Now write the date, the backup name and this result in replica/ops-log.md."
