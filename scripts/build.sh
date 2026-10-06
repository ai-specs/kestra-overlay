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

echo "== inject extension artifacts (locals/plugins) =="
if [ -d "$PWD/locals" ]; then
  mkdir -p "$WORK/locals"
  cp -r "$PWD/locals/." "$WORK/locals/"
  echo "injected: $(ls "$WORK/locals/plugins" 2>/dev/null | wc -l) plugin artifact(s)"
fi

echo "== build image (upstream base + patches + extension jars) =="
SHA="$(git rev-parse --short HEAD)"
docker buildx build -f "$WORK/Dockerfile" -t "ghcr.io/ai-specs/kestra-overlay:${SHA}" -t "ghcr.io/ai-specs/kestra-overlay:latest" --push "$WORK"
