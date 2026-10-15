#!/usr/bin/env bash
# One backup run: take an encrypted, checked copy with `npm run backup`, upload it with a create-only credential, remove the local
# copy only after the upload succeeded, record the time, and alert on any failure. Usage: backup.sh hourly|daily|monthly|premigration
# Settings come from the environment (systemd loads /etc/taskapp/taskapp.env and backup-upload.env); no secret is passed on a command line.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

kind=${1:-}
case "$kind" in hourly|daily|monthly|premigration) ;; *) die "usage: backup.sh hourly|daily|monthly|premigration" ;; esac
APP_DIR=${APP_DIR:-/opt/taskapp/current}
STATE_DIR=${STATE_DIR:-/var/lib/taskapp-backup}
refuse_placeholders BACKUP_KEY UPLOAD_TOOL UPLOAD_TARGET
case "${BACKUP_DEST:-}" in
  file:/*) outbox=${BACKUP_DEST#file:} ;;
  *) die "BACKUP_DEST must be file:/path, a local staging folder" ;;
esac
case "$UPLOAD_TOOL" in rclone|gsutil) ;; *) die "UPLOAD_TOOL must be rclone or gsutil" ;; esac
mkdir -p "$outbox" "$STATE_DIR"

# Only one backup at a time. A scheduled run that finds another going just skips; a pre-migration backup waits its turn.
exec 9>"$STATE_DIR/backup.lock"
if [ "$kind" = premigration ]; then flock -w 600 9 || die "another backup kept the lock for 10 minutes"
else flock -n 9 || { log "another backup is running; skipping this $kind run"; exit 0; }
fi

log "backup ($kind): taking and checking a copy"
if ! (cd "$APP_DIR" && npm run --silent backup -- --kind "$kind"); then
  alert "backup ($kind) failed while taking or checking the copy. Nothing was uploaded."
  exit 1
fi

upload_one() {   # $1 = file. Fixed commands per tool, never a string from a settings file. A create-only credential is enough: no read, list or delete.
  local file=$1 name
  name=$(basename "$file")
  case "$UPLOAD_TOOL" in
    rclone) rclone copyto --no-check-dest "$file" "$UPLOAD_TARGET/$name" ;;
    gsutil) gsutil -q cp "$file" "$UPLOAD_TARGET/$name" ;;
  esac
}

failed=0 sent=0
shopt -s nullglob
for f in "$outbox"/*; do
  name=$(basename "$f")
  if [[ ! "$name" =~ $BACKUP_NAME_RE ]]; then log "ignoring $name: not a backup file name" >&2; continue; fi
  if upload_one "$f"; then rm -f -- "$f"; sent=$((sent + 1)); log "uploaded $name"
  else failed=$((failed + 1)); log "upload of $name failed; it stays in the staging folder and will be retried" >&2
  fi
done
if [ "$failed" -gt 0 ]; then
  alert "backup ($kind): $failed file(s) could not be uploaded and are waiting on this machine."
  exit 1
fi
[ "$sent" -gt 0 ] || { alert "backup ($kind) produced no file to upload."; exit 1; }

now=$(date +%s)
printf '%s\n' "$now" > "$STATE_DIR/last-success"
printf '%s\n' "$now" > "$STATE_DIR/last-success-$kind"
if [ -n "${HEALTHCHECK_PING_URL:-}" ]; then curl -fsS -m 10 -o /dev/null "$HEALTHCHECK_PING_URL" || log "could not reach the check-in address" >&2; fi
log "backup ($kind): done, $sent file(s) uploaded"
