#!/usr/bin/env bash
# Shared helpers for the deployment scripts. Sourced, not run. Nothing here prints a secret: scripts only ever name variables and files, never show values.
# Secrets are never in the environment: they are files in $CREDENTIALS_DIRECTORY (systemd LoadCredential), read only when needed.

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

# The text of a credential, or nothing if there is none. The value is returned to the caller; it must never be logged.
credential() {
  local f="${CREDENTIALS_DIRECTORY:-}/$1"
  [ -n "${CREDENTIALS_DIRECTORY:-}" ] && [ -r "$f" ] || return 1
  head -n 1 "$f" | tr -d '\r\n'
}

json_escape() { printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# Tell a person. The message is made by these scripts (a unit name, an age), never data from the app. The webhook address is a secret, so it is handed to
# curl on its standard input (not on the command line, where `ps` would show it) and the body goes through a private file.
alert() {
  local msg=$1 url body
  log "ALERT: $msg" >&2
  if command -v logger >/dev/null 2>&1; then logger -t taskapp -p user.crit -- "$msg" || true; fi
  url=$(credential alert-webhook || true)
  if [ -n "$url" ]; then
    body=$(mktemp) || return 0
    printf '{"text":"taskapp on %s: %s"}' "$(hostname)" "$(json_escape "$msg")" > "$body"
    printf 'url = "%s"\n' "$url" | curl -fsS -m 10 -K - -X POST -H 'Content-Type: application/json' --data-binary "@$body" >/dev/null 2>&1 \
      || log "could not reach the alert webhook" >&2
    rm -f "$body"
  fi
  return 0
}

# A call to the dead-man's-switch address, empty, after every successful upload. If the calls stop, that service tells you even if this machine is gone.
ping_checkin() {
  local url; url=$(credential healthcheck-ping || true)
  [ -n "$url" ] || return 0
  printf 'url = "%s"\n' "$url" | curl -fsS -m 10 -K - -o /dev/null || log "could not reach the check-in address" >&2
}

# Backup file names are fixed in shape; anything else is not ours to upload, read or trust.
BACKUP_NAME_RE='^backup-(hourly|daily|monthly|premigration|manual)-([0-9]{8}T[0-9]{6}Z)\.db\.gz\.enc$'
# A name with a time more than ten minutes ahead of now is a forgery or a broken clock.
MAX_FUTURE_SECONDS=600

# 20301231T235959Z -> seconds since 1970
stamp_to_epoch() {
  local s=$1
  date -u -d "${s:0:4}-${s:4:2}-${s:6:2}T${s:9:2}:${s:11:2}:${s:13:2}Z" +%s
}

# Read a listing on standard input (one object per line, possibly full gs:// addresses) and print only the plain backup names. Anything else is skipped:
# blank lines, directories (a trailing slash), odd names, and names that do not match the fixed shape. The shape is checked FIRST, before any other use of the text.
valid_names() {
  local line name
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case "$line" in ''|*/) continue ;; esac
    name=${line##*/}
    [[ "$name" =~ $BACKUP_NAME_RE ]] && printf '%s\n' "$name"
  done
  return 0
}

# ---- Google Cloud Storage through `gcloud storage`, with the credential file named explicitly. The override means gcloud uses THAT identity and never the
# machine's own (on a cloud VM, gcloud would otherwise quietly use whatever the VM is allowed to do). verify-storage.sh proves what each identity can do.
GCLOUD=${GCLOUD:-gcloud}
gcs_setup() {
  local key="${CREDENTIALS_DIRECTORY:-}/gcs-key"
  [ -r "$key" ] || die "the storage credential is not available (systemd LoadCredential=gcs-key)"
  refuse_placeholders GCS_PREFIX
  case "$GCS_PREFIX" in gs://*[!/]) ;; *) die "GCS_PREFIX must look like gs://bucket/folder, with no trailing slash" ;; esac
  export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$key" CLOUDSDK_CORE_DISABLE_PROMPTS=1 CLOUDSDK_CORE_DISABLE_USAGE_REPORTING=true
  [ -n "${CLOUDSDK_CONFIG:-}" ] || export CLOUDSDK_CONFIG="${STATE_DIR:-/var/lib/taskapp-backup}/gcloud"
  mkdir -p -m 700 "$CLOUDSDK_CONFIG"
}
gcs_put() { "$GCLOUD" storage cp "$1" "$GCS_PREFIX/$2"; }    # $1 local file, $2 object name. No clobber flag: that would need read access, and an overwrite is refused anyway without delete rights.
gcs_ls()  { "$GCLOUD" storage ls "$GCS_PREFIX/"; }
gcs_get() { "$GCLOUD" storage cp "$GCS_PREFIX/$1" "$2"; }   # $1 object name, $2 local file
gcs_cat() { "$GCLOUD" storage cat "$GCS_PREFIX/$1"; }
gcs_rm()  { "$GCLOUD" storage rm "$GCS_PREFIX/$1"; }

# Is a TCP port on this machine already listening? (bash's own /dev/tcp, no extra tools)
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# Is the process $2 the one listening on local TCP port $1? Reads /proc, so a stranger who grabbed the port cannot pass for our app.
port_owned_by_pid() {
  local port=$1 pid=$2 hex inode fd
  hex=$(printf '%04X' "$port")
  for inode in $(awk -v h=":$hex" '$4 == "0A" && index($2, h) > 0 { print $10 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null); do
    for fd in /proc/"$pid"/fd/*; do
      [ "$(readlink "$fd" 2>/dev/null)" = "socket:[$inode]" ] && return 0
    done
  done
  return 1
}
