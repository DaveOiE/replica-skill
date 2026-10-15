#!/usr/bin/env bash
# Builds the host firewall from the template with YOUR SSH range, checks it, and loads it only if you say so.
#   SSH_RANGE=198.51.100.0/24 ./install-firewall.sh            # check only: prints the result, loads nothing
#   SSH_RANGE=198.51.100.0/24 ./install-firewall.sh --apply    # load it now (not saved: a reboot undoes it)
#   SSH_RANGE=198.51.100.0/24 ./install-firewall.sh --persist  # load it and save it for the next boot
# Keep a second SSH session open while applying. If you lose access: reboot (when not persisted) or use the cloud console.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"
template=${FIREWALL_TEMPLATE:-$here/../firewall/taskapp.nft.template}
mode=${1:-check}
case "$mode" in check|--apply|--persist) ;; *) die "usage: SSH_RANGE=<cidr> install-firewall.sh [--apply|--persist]" ;; esac

range=${SSH_RANGE:-}
[ -n "$range" ] || die "Set SSH_RANGE to the address range that may use SSH, for example SSH_RANGE=198.51.100.0/24"
case "$range" in *__REPLACE*) die "SSH_RANGE still holds a placeholder" ;; esac
case "$range" in 0.0.0.0/0|::/0|0.0.0.0/*|::/0*) die "SSH_RANGE must not be the whole internet" ;; esac
if [[ "$range" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?$ ]]; then fam="ip"
elif [[ "$range" =~ ^[0-9a-fA-F:]+(/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))?$ ]] && [[ "$range" == *:* ]]; then fam="ip6"
else die "SSH_RANGE is not an address or range: $range"; fi
# A range wider than /8 (or /16 for IPv6) is almost certainly a mistake.
if [ "$fam" = ip ] && [[ "$range" == */* ]] && [ "${range#*/}" -lt 8 ]; then die "SSH_RANGE is too wide: $range"; fi

rule="$fam saddr $range tcp dport 22 ct state new limit rate 10/minute accept"
out=$(mktemp); trap 'rm -f "$out"' EXIT
awk -v rule="$rule" '/@SSH_RULE@/ { sub(/# @SSH_RULE@/, rule) } { print }' "$template" > "$out"
grep -q '@SSH_RULE@' "$out" && die "the template marker was not replaced"
command -v nft >/dev/null || die "nft is not installed"
nft -c -f "$out" || die "the firewall rules did not pass nft's own syntax check"
log "firewall rules pass the syntax check (SSH allowed from $range; web on 80 and 443; everything else dropped)"
case "$mode" in
  check) cat "$out" ;;
  --apply) nft -f "$out"; log "loaded, not saved. Test a NEW ssh session now. A reboot undoes this." ;;
  --persist) nft -f "$out"; install -m 0600 -o root -g root "$out" /etc/nftables.conf; systemctl enable nftables; log "loaded and saved to /etc/nftables.conf" ;;
esac
