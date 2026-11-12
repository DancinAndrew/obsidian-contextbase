#!/usr/bin/env bash
# Prepares a vault for the M3 two-way demo (docs/demo.md): a copy of fixtures/vault with no
# agent memories yet. It installs nothing; run `contextbase init` on it yourself.
# usage: scripts/demo-setup.sh <new or empty folder>
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:?usage: scripts/demo-setup.sh <new or empty folder>}"

if [ -e "$target" ] && [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
  echo "$target is not empty; pick a new folder." >&2
  exit 1
fi

mkdir -p "$target"
cp -R "$repo/fixtures/vault/." "$target/"
rm -rf "$target/Agent Memory" "$target/私人" "$target/.contextbase"

echo "Demo vault ready: $target"
echo "Next: contextbase init --vault \"$target\"   (prints the changes; add --yes to apply them)"
