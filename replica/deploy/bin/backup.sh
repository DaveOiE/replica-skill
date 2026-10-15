#!/usr/bin/env bash
# Step 2 of a backup. Runs as the BACKUP user, after step 1 has left a checked snapshot: seal it (check again, encrypt, with the kind and time inside the
# authenticated header), upload with the create-only credential, remove the local copy only after the upload succeeded, record the time, alert on any failure.
#   backup.sh scheduled     always an hourly copy; plus the daily copy when due (first run at or after DAILY_HOUR each day); plus the monthly copy when due (first run each month)
#   backup.sh premigration  one premigration copy
# The key and the storage credential are files in $CREDENTIALS_DIRECTORY; neither is in the environment or on a command line.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

mode=${1:-}
case "$mode" in scheduled|premigration) ;; *) die "usage: backup.sh scheduled|premigration" ;; esac
APP_DIR=${APP_DIR:-/opt/taskapp/current}
NODE_BIN=${NODE_BIN:-/opt/node/bin/node}
STATE_DIR=${STATE_DIR:-/var/lib/taskapp-backup}
SNAPSHOT_DIR=${SNAPSHOT_DIR:-/var/lib/taskapp-snapshot}
OUTBOX=${OUTBOX:-$STATE_DIR/outbox}
DAILY_HOUR=${DAILY_HOUR:-2}
refuse_placeholders GCS_PREFIX
case "$DAILY_HOUR" in [0-9]|[01][0-9]|2[0-3]) ;; *) die "DAILY_HOUR must be an hour from 0 to 23" ;; esac
[ -n "${CREDENTIALS_DIRECTORY:-}" ] && [ -r "$CREDENTIALS_DIRECTORY/backup-key" ] || die "the backup key is not available (systemd LoadCredential=backup-key)"
gcs_setup
mkdir -p -m 700 "$STATE_DIR" "$OUTBOX"
snap="$SNAPSHOT_DIR/$mode.db"
cleanup() { rm -f -- "$snap" "$snap.partial"; }   # the plain copy never lingers, whatever happens
trap cleanup EXIT

# One run at a time, and a second one WAITS its turn (up to ten minutes): a skipped run would silently lose a daily or monthly copy.
exec 9>"$STATE_DIR/backup.lock"
flock -w 600 9 || die "another backup kept the lock for 10 minutes"

[ -f "$snap" ] && [ ! -L "$snap" ] || die "there is no snapshot at $snap: step 1 did not run or failed"

now=${NOW_EPOCH:-$(date +%s)}   # NOW_EPOCH is only for tests; the service never sets it
today=$(date -u -d "@$now" +%F); month=$(date -u -d "@$now" +%Y-%m); hour=$(date -u -d "@$now" +%H)
last_file() { cat "$STATE_DIR/$1" 2>/dev/null || true; }
kinds=()
if [ "$mode" = premigration ]; then kinds=(premigration)
else
  kinds=(hourly)
  if [ "$today" != "$(last_file last-daily-date)" ] && [ "$((10#$hour))" -ge "$((10#$DAILY_HOUR))" ]; then kinds+=(daily); fi
  if [ "$month" != "$(last_file last-monthly-month)" ] && [ "$((10#$hour))" -ge "$((10#$DAILY_HOUR))" ]; then kinds+=(monthly); fi
fi

export BACKUP_KEY_FILE="$CREDENTIALS_DIRECTORY/backup-key"
for kind in "${kinds[@]}"; do
  log "backup ($mode): sealing the $kind copy"
  if ! "$NODE_BIN" --no-warnings "$APP_DIR/app/cli/backup.js" seal --snapshot "$snap" --kind "$kind" --out "$OUTBOX"; then
    alert "backup ($mode): could not check and seal the $kind copy. Nothing was uploaded for it."
    exit 1
  fi
done

failed=0 sent=0
shopt -s nullglob
for f in "$OUTBOX"/*; do
  name=${f##*/}
  if [[ ! "$name" =~ $BACKUP_NAME_RE ]]; then log "ignoring $name: not a backup file name" >&2; continue; fi
  kind=${BASH_REMATCH[1]}
  if [ -L "$f" ] || [ ! -f "$f" ]; then log "ignoring $name: not a regular file" >&2; continue; fi
  if gcs_put "$f" "$name"; then
    rm -f -- "$f"; sent=$((sent + 1)); log "uploaded $name"
    t=$(mktemp -p "$STATE_DIR"); printf '%s\n' "$now" > "$t"; mv -f "$t" "$STATE_DIR/last-success-$kind"
    [ -f "$STATE_DIR/first-success" ] || { t=$(mktemp -p "$STATE_DIR"); printf '%s\n' "$now" > "$t"; mv -f "$t" "$STATE_DIR/first-success"; }
    case "$kind" in
      daily)   t=$(mktemp -p "$STATE_DIR"); printf '%s\n' "$today" > "$t"; mv -f "$t" "$STATE_DIR/last-daily-date" ;;
      monthly) t=$(mktemp -p "$STATE_DIR"); printf '%s\n' "$month" > "$t"; mv -f "$t" "$STATE_DIR/last-monthly-month" ;;
    esac
  else
    failed=$((failed + 1)); log "upload of $name failed; it stays in the staging folder and will be retried" >&2
  fi
done
if [ "$failed" -gt 0 ]; then alert "backup ($mode): $failed file(s) could not be uploaded and are waiting on this machine."; exit 1; fi
[ "$sent" -gt 0 ] || { alert "backup ($mode) produced no file to upload."; exit 1; }
ping_checkin
log "backup ($mode): done, $sent file(s) uploaded (${kinds[*]})"
