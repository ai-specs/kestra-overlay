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

echo "== apply thin patches (check first) =="
for p in patches/webserver/*.patch patches/ui/*.patch patches/deploy/*.patch; do
  git -C "$WORK" apply --check "$PWD/$p" || { echo "FAIL: $p"; exit 1; }
done
for p in patches/webserver/*.patch patches/ui/*.patch patches/deploy/*.patch; do
  git -C "$WORK" apply "$PWD/$p"
done

# migration A-files are added via a generated patch per BASE; see patches/migration
if [ -f patches/migration/apply.sh ]; then
  bash patches/migration/apply.sh "$WORK"
fi

echo "== extension jars (requires extension repos with built artifacts) =="
if [ -f scripts/build-extensions.sh ]; then
  bash scripts/build-extensions.sh "$WORK" || echo "WARN: extensions not baked (TODO: migrate extension repos first)"
fi

if [ "${1:-}" = "--apply-only" ]; then
  echo "OK: upstream+patches ready at $WORK"
  exit 0
fi

echo "== build image =="
docker build -f "$WORK/docker/Dockerfile" -t "$IMAGE_TAG" "$WORK"
if [ "$PUSH" = "1" ]; then
  echo "PUSH ghcr.io/ai-specs/kestra-overlay:$(git rev-parse --short HEAD)"
fi
