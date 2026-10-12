#!/usr/bin/env bash
set -euo pipefail

CANDIDATE="${1:?usage: promote-image.sh repository@sha256:digest}"
REPOSITORY="ghcr.io/ai-specs/kestra-overlay"
[[ "$CANDIDATE" =~ ^ghcr.io/ai-specs/kestra-overlay@sha256:[0-9a-f]{64}$ ]] || { echo 'FAIL: promotion requires an immutable candidate digest'; exit 1; }
CURRENT_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
if [ "$CURRENT_COMMIT" != "$REMOTE_COMMIT" ]; then
  echo 'SKIP: candidate commit is no longer the current main HEAD; deployment tags are unchanged'
  exit 0
fi
RELEASE="$(sed -n 1p patches/BASE)"
SHA="$(git rev-parse --short HEAD)"
docker buildx imagetools create \
  -t "${REPOSITORY}:${RELEASE}-no-plugins" \
  -t "${REPOSITORY}:${SHA}" \
  -t "${REPOSITORY}:latest" "$CANDIDATE"
