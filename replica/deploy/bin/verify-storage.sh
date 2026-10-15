#!/usr/bin/env bash
# Proves what a storage credential can and cannot do, by trying. Usage: verify-storage.sh uploader|checker|drill   (the credential is $CREDENTIALS_DIRECTORY/gcs-key)
#   uploader  may ADD a file; must NOT list, read, delete or overwrite
#   checker   may LIST; must NOT read, add or delete
#   drill     may LIST and READ; must NOT add or delete
# Prints PASS or FAIL for each, and exits non-zero if any FAIL. Run it once per identity at set-up and after any change to the storage permissions.
# The test file it adds (verify-<time>-<random>.txt) cannot be deleted by the uploader on purpose; the lifecycle rule in gcs/lifecycle.json removes it after a day.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"

role=${1:-}
case "$role" in uploader|checker|drill) ;; *) die "usage: verify-storage.sh uploader|checker|drill" ;; esac
STATE_DIR=${STATE_DIR:-/var/lib/taskapp-backup}
gcs_setup
fails=0
pass() { log "PASS: $*"; }
fail() { log "FAIL: $*" >&2; fails=$((fails + 1)); }
must_work() { local what=$1; shift; if "$@" >/dev/null 2>&1; then pass "$role can $what"; else fail "$role should be able to $what, and cannot"; fi; }
must_fail() { local what=$1; shift; if "$@" >/dev/null 2>&1; then fail "$role must NOT be able to $what, and CAN. This credential is too strong."; else pass "$role cannot $what"; fi; }

tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
case "$role" in
  uploader)
    name="verify-$(date +%s)-$RANDOM$RANDOM.txt"
    head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$tmp"
    must_work "add a file" gcs_put "$tmp" "$name"
    must_fail "list the folder" gcs_ls
    must_fail "read a file" gcs_cat "$name"
    must_fail "delete a file" gcs_rm "$name"
    must_fail "overwrite a file" gcs_put "$tmp" "$name"
    ;;
  checker|drill)
    must_work "list the folder" gcs_ls
    sample=$(gcs_ls 2>/dev/null | head -n 1 | sed 's|.*/||' || true)
    if [ -z "$sample" ]; then fail "there is nothing in the folder yet to test reading against: run the uploader check first"
    else
      if [ "$role" = drill ]; then must_work "read a file" gcs_get "$sample" "$tmp"; else must_fail "read a file" gcs_get "$sample" "$tmp"; fi
      must_fail "delete a file" gcs_rm "$sample"
    fi
    must_fail "add a file" gcs_put "$tmp" "verify-from-$role-$(date +%s).txt"
    ;;
esac
[ "$fails" -eq 0 ] || die "$fails check(s) failed for $role. Fix the permissions before trusting this setup."
log "storage check for $role: all as intended"
