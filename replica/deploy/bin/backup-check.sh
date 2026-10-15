#!/usr/bin/env bash
# Alerts if the newest backup is older than MAX_AGE_SECONDS (default 3 hours), or if there is none, or if finished copies are stuck
# waiting to upload. Two ways to know the newest backup:
#   default          the time of the last successful upload, written by backup.sh on this machine (works with a create-only credential)
#   CHECK_REMOTE=1   the names in the destination, read with UPLOAD_TOOL (run this from ANOTHER machine, with a list-only credential,
#                    so the answer does not depend on the machine being watched)
# Exit codes: 0 fresh, 2 stale or missing, 1 could not check.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

STATE_DIR=${STATE_DIR:-/var/lib/taskapp-backup}
max=${MAX_AGE_SECONDS:-10800}
now=${NOW_EPOCH:-$(date +%s)}
case "$max" in ''|*[!0-9]*) die "MAX_AGE_SECONDS must be a number of seconds" ;; esac

newest=0
if [ "${CHECK_REMOTE:-0}" = 1 ]; then
  refuse_placeholders UPLOAD_TOOL UPLOAD_TARGET
  case "$UPLOAD_TOOL" in
    rclone) listing=$(rclone lsf "$UPLOAD_TARGET") || { alert "backup check: could not list the backup destination"; exit 1; } ;;
    gsutil) listing=$(gsutil ls "$UPLOAD_TARGET/") || { alert "backup check: could not list the backup destination"; exit 1; } ;;
    *) die "UPLOAD_TOOL must be rclone or gsutil" ;;
  esac
  while IFS= read -r line; do
    name=$(basename "${line:-}")
    [[ "$name" =~ $BACKUP_NAME_RE ]] || continue
    ts=$(printf '%s' "$name" | grep -oE '[0-9]{8}T[0-9]{6}Z')
    e=$(stamp_to_epoch "$ts") || continue
    [ "$e" -gt "$newest" ] && newest=$e
  done <<< "$listing"
else
  if [ -f "$STATE_DIR/last-success" ]; then newest=$(tr -dc '0-9' < "$STATE_DIR/last-success"); fi
fi

problem=""
if [ "${newest:-0}" -le 0 ]; then
  problem="no backup has been recorded at all"
else
  age=$((now - newest))
  hours=$(awk -v a="$age" 'BEGIN { printf "%.1f", a / 3600 }')
  if [ "$age" -gt "$max" ]; then problem="the newest backup is $hours hours old (limit $(awk -v m="$max" 'BEGIN { printf "%.1f", m / 3600 }'))"; fi
fi

# Finished copies that never left the machine are also a problem, even if an older upload was recent.
case "${BACKUP_DEST:-}" in
  file:/*)
    outbox=${BACKUP_DEST#file:}
    if [ -d "$outbox" ] && [ -n "$(find "$outbox" -maxdepth 1 -type f -name 'backup-*.enc' -mmin +$((max / 60)) -print -quit)" ]; then
      problem="${problem:+$problem; }backup files are stuck in the staging folder and not uploading"
    fi ;;
esac

if [ -n "$problem" ]; then alert "backup check: $problem"; exit 2; fi
log "backup check: newest backup is $hours hours old, within the limit"
