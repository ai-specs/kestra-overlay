#!/usr/bin/env bash
# kestra-overlay build: clone upstream at pinned SHA -> apply thin patches -> build image
# Usage: ./scripts/build.sh [--apply-only]
set -euo pipefail

BASE="$(cat patches/BASE)"
UPSTREAM_REPO="${KESTRA_UPSTREAM_REPO:-https://github.com/kestra-io/kestra.git}"
WORK="${WORK:-$(mktemp -d)}"
IMAGE_TAG="${IMAGE_TAG:-kestra-overlay:dev}"
PUSH="${PUSH:-0}"

echo "== kestra-overlay: upstream=$UPSTREAM_REPO base=$BASE =="
if [ ! -d "$WORK/.git" ]; then
  git clone --filter=blob:none --no-checkout "$UPSTREAM_REPO" "$WORK"
fi
git -C "$WORK" checkout -q "$BASE"
git -C "$WORK" checkout -q -b overlay

echo "== zero source patches (extension jars via upstream plugins/ slot) =="
# Official Dockerfile copies /mnt/context/plugins/. -> /app/plugins (build
# context bind mount); extension jars staged into $WORK/plugins/ are baked
# natively — no Dockerfile modification needed.

echo "== stage vendored extension artifacts (plugins/ baseline) =="
if [ -d "$PWD/locals/plugins" ]; then
  mkdir -p "$WORK/plugins"
  cp -r "$PWD/locals/plugins/." "$WORK/plugins/"
  echo "vendored baseline: $(ls "$WORK/plugins" | wc -l) plugin artifact(s)"
fi

echo "== extension artifacts (requires extension repos with built artifacts) =="
bash scripts/build-extensions.sh "$WORK"

if [ "${1:-}" = "--apply-only" ]; then
  echo "OK: upstream + staged extensions ready at $WORK"
  exit 0
fi

echo "== build image (official base + staged extension jars) =="
SHA="$(git rev-parse --short HEAD)"
docker buildx build -f "$WORK/Dockerfile" -t "ghcr.io/ai-specs/kestra-overlay:${SHA}" -t "ghcr.io/ai-specs/kestra-overlay:latest" --push "$WORK"
