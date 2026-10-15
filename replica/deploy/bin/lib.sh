#!/usr/bin/env bash
# Shared helpers for the deployment scripts. Sourced, not run. Nothing here prints a secret: scripts only ever name variables, never show values.

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# A placeholder left in a settings file means the file was never filled in.
refuse_placeholders() {
  local name
  for name in "$@"; do
    case "${!name:-}" in
      '') die "$name is not set" ;;
      *__REPLACE*) die "$name still holds a placeholder. Edit the settings file first." ;;
    esac
  done
}

json_escape() { printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# Tell a person. The message is made by these scripts (a unit name, an age), never data from the app.
alert() {
  local msg=$1
  log "ALERT: $msg" >&2
  if command -v logger >/dev/null 2>&1; then logger -t taskapp -p user.crit -- "$msg" || true; fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
      --data "{\"text\":\"taskapp on $(hostname): $(json_escape "$msg")\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 \
      || log "could not reach the alert webhook" >&2
  fi
  return 0
}

# Backup file names are fixed in shape; anything else is not ours to upload or trust.
BACKUP_NAME_RE='^backup-(hourly|daily|monthly|premigration|manual)-[0-9]{8}T[0-9]{6}Z\.db\.gz\.enc$'

# 20301231T235959Z -> seconds since 1970
stamp_to_epoch() {
  local s=$1
  date -u -d "${s:0:4}-${s:4:2}-${s:6:2}T${s:9:2}:${s:11:2}:${s:13:2}Z" +%s
}
