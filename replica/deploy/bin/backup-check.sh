#!/usr/bin/env bash
# Alerts when backups are not fresh, kind by kind: the newest hourly copy older than MAX_AGE_HOURLY (3 hours), daily older than MAX_AGE_DAILY (26 hours), monthly older than
# MAX_AGE_MONTHLY (32 days); a kind that has never existed once the system is old enough to have one; any backup name with a time in the future (a forgery or a broken clock);
# and finished copies stuck in the staging folder. Two ways to know what exists:
#   default          the time of each kind's last successful upload, written by backup.sh on this machine
#   CHECK_REMOTE=1   the names in the destination, read with the LIST-ONLY credential (the systemd unit uses this: it does not depend on the machine's own record)
# Exit codes: 0 fresh, 2 a problem was found, 1 could not check.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

STATE_DIR=${STATE_DIR:-/var/lib/taskapp-backup}
OUTBOX=${OUTBOX:-$STATE_DIR/outbox}
now=${NOW_EPOCH:-$(date +%s)}
declare -A limit=( [hourly]=${MAX_AGE_HOURLY:-10800} [daily]=${MAX_AGE_DAILY:-93600} [monthly]=${MAX_AGE_MONTHLY:-2764800} )
for k in hourly daily monthly; do case "${limit[$k]}" in ''|*[!0-9]*) die "the age limit for $k must be a number of seconds" ;; esac; done

declare -A newest=( [hourly]=0 [daily]=0 [monthly]=0 )
earliest=0; future=0
note() {  # kind epoch
  local kind=$1 e=$2
  if [ "$e" -gt "$((now + MAX_FUTURE_SECONDS))" ]; then future=$((future + 1)); return; fi
  case "$kind" in hourly|daily|monthly) [ "$e" -gt "${newest[$kind]}" ] && newest[$kind]=$e ;; esac
  if [ "$earliest" -eq 0 ] || [ "$e" -lt "$earliest" ]; then earliest=$e; fi
  return 0
}

if [ "${CHECK_REMOTE:-0}" = 1 ]; then
  gcs_setup
  listing=$(gcs_ls) || { alert "backup check: could not list the backup destination"; exit 1; }
  while IFS= read -r name; do
    [[ "$name" =~ $BACKUP_NAME_RE ]] || continue
    e=$(stamp_to_epoch "${BASH_REMATCH[2]}") || continue
    note "${BASH_REMATCH[1]}" "$e"
  done < <(printf '%s\n' "$listing" | valid_names)
else
  for k in hourly daily monthly; do
    v=$(tr -dc '0-9' < "$STATE_DIR/last-success-$k" 2>/dev/null || true)
    [ -n "$v" ] && note "$k" "$v"
  done
  f=$(tr -dc '0-9' < "$STATE_DIR/first-success" 2>/dev/null || true)
  [ -n "$f" ] && [ "$f" -gt 0 ] && { earliest=$f; }
fi

problems=()
[ "$future" -gt 0 ] && problems+=("$future backup name(s) claim a time in the future, which is a forgery or a broken clock")
for k in hourly daily monthly; do
  if [ "${newest[$k]}" -le 0 ]; then
    # Missing is only a problem once the system has been running longer than that kind's limit (a new install has no daily or monthly copy yet).
    if [ "$earliest" -gt 0 ] && [ "$((now - earliest))" -gt "${limit[$k]}" ]; then problems+=("no $k backup exists"); fi
    if [ "$k" = hourly ] && [ "$earliest" -eq 0 ]; then problems+=("no backup has been recorded at all"); fi
    continue
  fi
  age=$((now - ${newest[$k]}))
  if [ "$age" -gt "${limit[$k]}" ]; then
    problems+=("the newest $k backup is $(awk -v a="$age" 'BEGIN { printf "%.1f", a / 3600 }') hours old (limit $(awk -v m="${limit[$k]}" 'BEGIN { printf "%.1f", m / 3600 }'))")
  fi
done

# Finished copies that never left the machine are also a problem, even if an older upload was recent.
if [ -d "$OUTBOX" ] && [ -n "$(find "$OUTBOX" -maxdepth 1 -type f -name 'backup-*.enc' -mmin +$((${limit[hourly]} / 60)) -print -quit)" ]; then
  problems+=("backup files are stuck in the staging folder and not uploading")
fi

if [ "${#problems[@]}" -gt 0 ]; then
  msg=$(IFS=';'; printf '%s' "${problems[*]}")
  alert "backup check: ${msg//;/; }"
  exit 2
fi
ageof() { if [ "${newest[$1]}" -gt 0 ]; then printf '%s' "$(awk -v a="$((now - ${newest[$1]}))" 'BEGIN { if (a < 7200) printf "%d min", a / 60; else if (a < 172800) printf "%.1f h", a / 3600; else printf "%.1f days", a / 86400 }')"; else printf 'none yet'; fi; }
log "backup check: newest hourly $(ageof hourly), daily $(ageof daily), monthly $(ageof monthly): all within their limits"
