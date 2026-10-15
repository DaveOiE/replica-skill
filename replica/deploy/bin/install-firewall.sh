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
addr=${range%%/*}; prefix=""; [[ "$range" == */* ]] && prefix=${range#*/}
if [[ "$addr" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
  fam="ip"; max=32; min=16
  for o in "${BASH_REMATCH[@]:1}"; do [ "$o" -le 255 ] || die "SSH_RANGE is not an address or range: $range"; done
  case "${BASH_REMATCH[1]}" in 0|127|22[4-9]|2[3-5][0-9]) die "SSH_RANGE must be an ordinary address range, not $range" ;; esac
elif [[ "$addr" == *:* && "$addr" =~ ^[0-9a-fA-F:]+$ ]]; then
  fam="ip6"; max=128; min=48
  [[ "$addr" =~ ^(0*:)+0*$ ]] && die "SSH_RANGE must not be the unspecified address: $range"
else die "SSH_RANGE is not an address or range: $range"; fi
[ -z "$prefix" ] && prefix=$max
[[ "$prefix" =~ ^[0-9]{1,3}$ ]] && [ "$prefix" -le "$max" ] || die "SSH_RANGE has a bad prefix length: $range"
# Not the whole internet, and not close to it: an SSH range is a few networks you control. IPv4 no wider than /16 (65,536 addresses), IPv6 no wider than /48.
[ "$prefix" -ge "$min" ] || die "SSH_RANGE $range is too wide: the prefix must be /$min or longer. List the actual networks that need SSH."

# SSH is slowed per source address: one noisy source cannot use up the allowance and lock the owner out.
rule="$fam saddr $range tcp dport 22 ct state new meter ssh_$fam { $fam saddr timeout 5m limit rate 10/minute } accept"
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
