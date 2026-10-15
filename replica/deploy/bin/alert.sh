#!/usr/bin/env bash
# Sends one alert. Used by the OnFailure= handler. Usage: alert.sh "message"
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$here/lib.sh"
alert "${1:-an alert was raised, no message}"
