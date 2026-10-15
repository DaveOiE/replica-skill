#!/usr/bin/env bash
# Restore drill, run by the BACKUP user through taskapp-restore-drill.service (or by hand with the same environment). Fetches a backup with the READ-ONLY credential,
# restores it into a scratch folder this script creates, starts a throw-away app on a spare port with a clean environment, proves the process that answers is that app,
# and deletes everything it made. It never touches the live database (its unit cannot even see it).
#   restore-drill.sh [exact backup name]          default: the newest backup whose name is plausible (shape fixed, time not in the future)
# The restore step checks integrity and the audit chain, refuses a file whose kind or time inside differs from its name (a renamed or forged file), and compares
# the restored data with the fingerprint recorded when the backup was taken. A forged "newest" name therefore makes the drill FAIL; it cannot make it pass.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

APP_DIR=${APP_DIR:-/opt/taskapp/current}
NODE_BIN=${NODE_BIN:-/opt/node/bin/node}
STATE_DIR=${STATE_DIR:-/var/lib/taskapp-backup}
DRILL_BASE=${DRILL_BASE:-$STATE_DIR/drill}
refuse_placeholders LIVE_DB_PATH DRILL_PORT DRILL_BASE
LIVE_PORT=${LIVE_PORT:-3000}
[ -n "${CREDENTIALS_DIRECTORY:-}" ] && [ -r "$CREDENTIALS_DIRECTORY/backup-key" ] || die "the backup key is not available (systemd LoadCredential=backup-key)"
gcs_setup

# Guard rails: the base folder must exist (this script does not create it), be nowhere near the live database, and the spare port must differ from the live one AND be free.
[ -d "$DRILL_BASE" ] || die "the drill base folder $DRILL_BASE does not exist (it is created with the state folder)"
base=$(realpath "$DRILL_BASE"); live=$(realpath -m "$(dirname "$LIVE_DB_PATH")")
[ "$base" != "/" ] || die "refusing to use / as the drill base"
case "$live/" in "$base/"*) die "the drill base folder contains the live database folder" ;; esac
case "$base/" in "$live/"*) die "the drill base folder is inside the live database folder" ;; esac
case "$DRILL_PORT" in ''|*[!0-9]*) die "DRILL_PORT must be a number" ;; esac
[ "$DRILL_PORT" != "$LIVE_PORT" ] || die "DRILL_PORT must differ from the live port"
if port_in_use "$DRILL_PORT"; then die "something is already listening on port $DRILL_PORT, so an answer from it would prove nothing. Pick a free DRILL_PORT."; fi

# Which backup
want=${1:-${DRILL_NAME:-}}
if [ -z "$want" ]; then
  now=$(date +%s); best=0
  while IFS= read -r n; do
    [[ "$n" =~ $BACKUP_NAME_RE ]] || continue
    e=$(stamp_to_epoch "${BASH_REMATCH[2]}") || continue
    if [ "$e" -gt "$((now + MAX_FUTURE_SECONDS))" ]; then log "skipping $n: its time is in the future" >&2; continue; fi
    if [ "$e" -gt "$best" ]; then best=$e; want=$n; fi
  done < <(gcs_ls | valid_names)
  [ -n "$want" ] || die "no usable backups found at the destination"
fi
[[ "$want" =~ $BACKUP_NAME_RE ]] || die "that is not a backup file name"
log "drill: using $want"

# A scratch folder made here, fresh, private; only this exact folder is ever deleted.
work=$(mktemp -d -p "$DRILL_BASE" drill.XXXXXX) || die "could not make a scratch folder"
chmod 700 "$work"
app_pid=""
cleanup() { [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true; [ -n "${work:-}" ] && [ -d "$work" ] && rm -rf -- "$work"; }
trap cleanup EXIT

gcs_get "$want" "$work/$want" || die "DRILL FAILED: could not fetch $want"

# Restore. The name is given as the confirmation because this is a scratch restore; a real restore asks a person to type it.
export BACKUP_KEY_FILE="$CREDENTIALS_DIRECTORY/backup-key"
(cd "$APP_DIR" && "$NODE_BIN" --no-warnings app/cli/backup.js restore --from "$work/$want" --to "$work/app.db" --confirm "$want") || die "DRILL FAILED: the backup did not restore (wrong key, renamed or forged file, damaged data, or a mismatch with what was recorded)"

# A throw-away app on the restored file, with an EMPTY environment: no key, no credential, nothing from this unit.
(cd "$APP_DIR" && exec env -i PATH=/usr/bin:/bin DB_PATH="$work/app.db" PORT="$DRILL_PORT" PUBLIC_URL="http://127.0.0.1:$DRILL_PORT" TRUST_PROXY=false \
   "$NODE_BIN" --no-warnings app/server/index.js >"$work/app.log" 2>&1) &
app_pid=$!
ok=0
for _ in $(seq 1 40); do
  if curl -fsS -m 2 "http://127.0.0.1:$DRILL_PORT/api/v1/health" 2>/dev/null | grep -q '"ok":true'; then ok=1; break; fi
  kill -0 "$app_pid" 2>/dev/null || break
  sleep 0.5
done
[ "$ok" = 1 ] || die "DRILL FAILED: the restored copy did not start and answer. Log: $(tail -n 5 "$work/app.log" | tr '\n' ' ')"
kill -0 "$app_pid" 2>/dev/null || die "DRILL FAILED: the app exited, so the answer did not come from it"
port_owned_by_pid "$DRILL_PORT" "$app_pid" || die "DRILL FAILED: the process answering on port $DRILL_PORT is not the throw-away app"
log "DRILL PASSED: $want restored, its data matched the fingerprint recorded when it was taken, and the throw-away app (process $app_pid) answered on port $DRILL_PORT. Scratch folder removed."
log "Now write the date, the backup name and this result in replica/ops-log.md."
