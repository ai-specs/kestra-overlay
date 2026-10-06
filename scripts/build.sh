#!/usr/bin/env bash
# kestra-overlay build: clone upstream at pinned SHA -> apply thin patches ->
# compile webserver (executableJar) -> stage extension jars -> build image.
# Usage: ./scripts/build.sh [--apply-only]
#
# Fork-stack shape (verified against app-kestra): the base image is a
# runtime-only environment; the webserver binary is host-built via gradle
# executableJar and copied into the image as docker/app/kestra. Patches touch
# only sources that are compiled into that jar (webserver controllers/filters/
# rooter/services + migrations + build/deploy wiring). Dockerfile/Dockerfile.base
# are used unmodified from upstream.
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
# Transition: patches carry the fork's current customizations verbatim
# (behavior parity with the fork stack). As each surface moves into an
# extension repo, the corresponding patch narrows to an activation/
# registration placeholder (target doc §3.3 principle 1).
for p in patches/*/*.patch; do
  git -C "$WORK" apply --check "$PWD/$p" || { echo "FAIL: $p"; exit 1; }
done
for p in patches/*/*.patch; do
  git -C "$WORK" apply "$PWD/$p"
done

echo "== compile webserver executable jar (thin-patched upstream) =="
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 25 2>/dev/null || true)"
fi
(cd "$WORK" && ./gradlew executableJar --console=plain -x test -x check)
EXE="$(ls -t "$WORK"/build/executable/* | head -1)"
mkdir -p "$WORK/docker/app"
cp "$EXE" "$WORK/docker/app/kestra"
chmod +x "$WORK/docker/app/kestra"
echo "webserver jar staged: $(basename "$EXE") -> docker/app/kestra"

echo "== stage vendored extension artifacts (plugins/ baseline) =="
if [ -d "$PWD/locals/plugins" ]; then
  mkdir -p "$WORK/plugins"
  cp -r "$PWD/locals/plugins/." "$WORK/plugins/"
  echo "vendored baseline: $(ls "$WORK/plugins" | wc -l) plugin artifact(s)"
fi

echo "== extension artifacts (requires extension repos with built artifacts) =="
bash scripts/build-extensions.sh "$WORK"

if [ "${1:-}" = "--apply-only" ]; then
  echo "OK: upstream + patches + staged extensions ready at $WORK"
  exit 0
fi

echo "== build image (upstream Dockerfile.base/Dockerfile unmodified) =="
SHA="$(git rev-parse --short HEAD)"
docker buildx build -f "$WORK/Dockerfile" -t "ghcr.io/ai-specs/kestra-overlay:${SHA}" -t "ghcr.io/ai-specs/kestra-overlay:latest" --push "$WORK"
