#!/usr/bin/env bash
# Installs one credential as a root-only file, reading its value from standard input so it never appears on a command line or in shell history.
#   sudo ./install-credential.sh backup-key          (paste the value when asked, then press Enter)
#   sudo ./install-credential.sh uploader-key.json < the-key-file.json
# Names: backup-key, uploader-key.json, checker-key.json, drill-key.json, alert-webhook, healthcheck-ping. The last two may be empty (a blank file), but must exist.
# systemd copies each file into a private folder for the one unit that is allowed it (LoadCredential=), so the file itself stays root-only.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

name=${1:-}; mode=${2:-}
case "$name" in backup-key|uploader-key.json|checker-key.json|drill-key.json|alert-webhook|healthcheck-ping) ;; *) die "name must be one of: backup-key, uploader-key.json, checker-key.json, drill-key.json, alert-webhook, healthcheck-ping" ;; esac
CRED_DIR=${CRED_DIR:-/etc/taskapp/credentials}
[ -d "$CRED_DIR" ] || die "$CRED_DIR does not exist. Create it first: install -d -o root -g root -m 0700 $CRED_DIR"
dest="$CRED_DIR/$name"
if [ -e "$dest" ] && [ "$mode" != --replace ]; then die "$name already exists. Pass --replace as the second argument to replace it."; fi

umask 077
if [ -t 0 ]; then IFS= read -r -s -p "Value for $name (not shown): " value; echo >&2
else value=$(cat); fi
if [ "$name" = backup-key ] && [[ ! "$value" =~ ^[0-9a-f]{64}$ ]]; then die "the backup key must be 64 hex characters (from backup:keygen). Nothing was written."; fi
case "$name" in
  alert-webhook|healthcheck-ping) ;;
  *) [ -n "$value" ] || die "that credential cannot be empty. Nothing was written." ;;
esac
tmp=$(mktemp -p "$CRED_DIR" .incoming.XXXXXX)
printf '%s\n' "$value" > "$tmp"
if [ "$(id -u)" -eq 0 ]; then chown root:root "$tmp"; fi
chmod 600 "$tmp"
mv -f "$tmp" "$dest"
unset value
log "installed $name (root-only, mode 600). Its value was not shown or logged."
