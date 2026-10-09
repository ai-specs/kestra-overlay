#!/usr/bin/env bash
# kestra-overlay build: clone upstream at pinned SHA -> apply thin patches ->
# compile webserver (executableJar) -> stage extension jars -> build image.
# Usage: ./scripts/build.sh [--apply-only]
#
# Delivery shape (mechanism facts, docs/extension-mechanisms.md F1): upstream
# ships a selfrun executable jar (exec java -jar) and a runtime-only base
# image; the webserver binary must be host-built via gradle executableJar and
# copied into the image as docker/app/kestra. Patches therefore touch only
# sources compiled into that jar (webserver controllers/filters/rooter/
# services). Dockerfile/Dockerfile.base are unmodified from upstream.
# Extension jars are injected by build-extensions.sh per extensions.tsv
# (never vendored as binaries in this repo).
set -euo pipefail

RELEASE="$(sed -n 1p patches/BASE)"
BASE="$(sed -n 2p patches/BASE)"
UPSTREAM_REPO="${KESTRA_UPSTREAM_REPO:-https://github.com/kestra-io/kestra.git}"
WORK="${WORK:-$(mktemp -d)}"
IMAGE_TAG="${IMAGE_TAG:-kestra-overlay:dev}"

echo "== kestra-overlay: upstream=$UPSTREAM_REPO base=$BASE =="
if [ ! -d "$WORK/.git" ]; then
  git clone --filter=blob:none --no-checkout "$UPSTREAM_REPO" "$WORK"
fi
git -C "$WORK" checkout -q "$BASE"
git -C "$WORK" checkout -q -b overlay

echo "== apply requirement-aligned patches (check first, lexical order) =="
# One patch = one requirement (header comments carry the requirement
# record; manifest.tsv is the ledger — both enforced by check-patches.sh).
# Apply order = lexical filename order; per-patch provenance/status/removal
# conditions live in patches/manifest.tsv, see AGENTS.md §3.
# Sequentially check-then-apply per patch: requirement-aligned patches may carry
# coordinates relative to earlier patches' applied state (observed historically;
# the patch pair in question is since removed, the rule stays) — a check against
# the pristine tree would wrongly fail them (AGENTS.md §3 requirement-aligned
# granularity / §8-8).
for p in patches/*/*.patch; do
  git -C "$WORK" apply --check "$PWD/$p" || { echo "FAIL: $p"; exit 1; }
  git -C "$WORK" apply "$PWD/$p"
done

if [ "${1:-}" = "--apply-only" ]; then
  echo "OK: upstream + patches ready at $WORK (verify only, no compile)"
  exit 0
fi

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

echo "== extension artifacts (from extension repos; see build-extensions.sh) =="
bash scripts/build-extensions.sh "$WORK"

echo "== build image (upstream Dockerfile.base/Dockerfile unmodified) =="
SHA="$(git rev-parse --short HEAD)"
# Image lineage: zero plugin/extension jars are baked (extensions.tsv has no
# active plugin/classpath rows; build-extensions.sh leaves $WORK/plugins empty)
# — the same content family as upstream's slim/no-plugins variants. Main tag
# suffix "-no-plugins" (maintainer naming ruling 2026-10-07). One deliberate
# difference from the upstream no-plugins variant: we bake NO Kestra config,
# so auto-install keeps its source default (OSS + storage.type=local => on),
# whereas upstream's no-plugins bakes it off. Deployments wanting the hardened
# behavior set it explicitly via KESTRA_CONFIGURATION (channel ④, restart).
# The overlay commit tag keeps traceability; latest is the rolling convenience.
docker buildx build -f "$WORK/Dockerfile" \
  --platform linux/amd64,linux/arm64 \
  -t "ghcr.io/ai-specs/kestra-overlay:${RELEASE}-no-plugins" \
  -t "ghcr.io/ai-specs/kestra-overlay:${SHA}" \
  -t "ghcr.io/ai-specs/kestra-overlay:latest" --push "$WORK"
