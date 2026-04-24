#!/bin/sh
# Usage: check-coverage.sh <min percent> <coverage profile>
set -eu
min=${1:-90}
prof=${2:?"coverage file required"}
last=$(go tool cover -func="$prof" | tail -1)
echo "$last"
pct=$(printf '%s' "$last" | sed -nE 's/.*[[:space:]]([0-9.]+)%.*/\1/p')
if [ -z "$pct" ]; then
  echo "could not parse coverage: $last" >&2
  exit 1
fi
# shellcheck disable=SC2003
# Compare floats using awk
if awk -v p="$pct" -v m="$min" 'BEGIN{ if (p+0 < m+0) exit 1; exit 0; }' </dev/null; then
  echo "OK: coverage $pct% >= $min%"
else
  echo "coverage $pct% is below minimum ${min}%" >&2
  exit 1
fi
