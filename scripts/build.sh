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
# Skeleton holds exactly one source-level patch: the Dockerfile locals/plugins
# injection point (overlay image = official kestra-base + extension jars; java/ui
# sources are NOT compiled in this image, so webserver/ui/migration diffs from
# the fork are out of skeleton scope — they belong to the extension repos).
for p in patches/deploy/*.patch; do
  git -C "$WORK" apply --check "$PWD/$p" || { echo "FAIL: $p"; exit 1; }
done
for p in patches/deploy/*.patch; do
  git -C "$WORK" apply "$PWD/$p"
done

echo "== inject vendored extension artifacts (locals/plugins baseline) =="
if [ -d "$PWD/locals" ]; then
  mkdir -p "$WORK/locals"
  cp -r "$PWD/locals/." "$WORK/locals/"
  echo "vendored baseline: $(ls "$WORK/locals/plugins" 2>/dev/null | wc -l) plugin artifact(s)"
fi

echo "== extension artifacts (requires extension repos with built artifacts) =="
bash scripts/build-extensions.sh "$WORK"

if [ "${1:-}" = "--apply-only" ]; then
  echo "OK: upstream+patches ready at $WORK"
  exit 0
fi

echo "== build image (upstream base + patches + extension jars) =="
SHA="$(git rev-parse --short HEAD)"
docker buildx build -f "$WORK/Dockerfile" -t "ghcr.io/ai-specs/kestra-overlay:${SHA}" -t "ghcr.io/ai-specs/kestra-overlay:latest" --push "$WORK"
