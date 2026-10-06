#!/usr/bin/env bash
# apply migration A-file patches (add-only) onto the patched work tree
set -euo pipefail
WORK="${1:?work tree}"
DIR="$(cd "$(dirname "$0")" && pwd)"
for p in "$DIR"/*.patch; do
  git -C "$WORK" apply "$p"
done
echo "OK: migration files applied"
