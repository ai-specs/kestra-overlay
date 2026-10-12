#!/usr/bin/env bash
# kestra-overlay build: clone upstream at pinned SHA -> apply thin patches ->
# compile UI/webserver (executableJar) -> build immutable candidate image.
# Usage: ./scripts/build.sh [--apply-only]
#
# Delivery shape (mechanism facts, docs/extension-mechanisms.md F1): upstream
# ships a selfrun executable jar (exec java -jar) and a runtime-only base
# image; the webserver binary must be host-built via gradle executableJar and
# copied into the image as docker/app/kestra. Patches therefore touch only
# sources compiled into that jar (webserver controllers/filters/rooter/
# services). Dockerfile/Dockerfile.base are unmodified from upstream.
# build-extensions.sh validates the registry; the no-plugins image bakes zero
# external extension jars. Deployment-side mounts supply those artifacts.
set -euo pipefail

RELEASE="$(sed -n 1p patches/BASE)"
BASE="$(sed -n 2p patches/BASE)"
UPSTREAM_REPO="${KESTRA_UPSTREAM_REPO:-https://github.com/kestra-io/kestra.git}"
WORK="${WORK:-$(mktemp -d)}"
IMAGE_REPOSITORY="ghcr.io/ai-specs/kestra-overlay"
BUILD_ID="${GITHUB_RUN_ID:-local-$(date -u +%Y%m%d%H%M%S)}-${GITHUB_RUN_ATTEMPT:-1}"
CANDIDATE_TAG="${IMAGE_REPOSITORY}:candidate-$(git rev-parse HEAD)-${BUILD_ID}"
IMAGE_BASE="$(cat patches/IMAGE_BASE)"
[[ "$IMAGE_BASE" =~ ^ghcr.io/kestra-io/kestra-base@sha256:[0-9a-f]{64}$ ]] || { echo 'FAIL: invalid pinned image base'; exit 1; }

echo "== kestra-overlay: upstream=$UPSTREAM_REPO base=$BASE =="
if [ ! -d "$WORK/.git" ]; then
  git clone --depth 1 --branch "$RELEASE" "$UPSTREAM_REPO" "$WORK"
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

echo "== scoped OIDC acceptance tests =="
(cd "$WORK" && ./gradlew :webserver:test --tests 'io.kestra.webserver.oidc.*' \
  --tests io.kestra.mcp.McpExecutionGateTest --tests io.kestra.mcp.McpSessionIdentityTest \
  --tests io.kestra.mcp.McpServerHandlerTransportTest --console=plain)

echo "== build upstream UI assets =="
(cd "$WORK/ui" && npm ci && npm run build)
(cd "$WORK/ui" && npm run test:unit -- src/utils/authentication.spec.ts)
test -s "$WORK/webserver/src/main/resources/ui/index.html"

echo "== compile webserver executable jar (thin-patched upstream) =="
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 25 2>/dev/null || true)"
fi
(cd "$WORK" && ./gradlew executableJar --console=plain -x test -x check)
EXE="$(ls -t "$WORK"/build/executable/* | head -1)"
mkdir -p "$WORK/docker/app"
cp "$EXE" "$WORK/docker/app/kestra"
chmod +x "$WORK/docker/app/kestra"
# Pre-create the storage dir with kestra ownership: the upstream image has no /app/storage,
# so a named volume mounted there initializes root-owned and the uid-1000 process crashes
# with AccessDenied on first boot (third-party test 2026-10-09). COPY docker / carries the
# ownership in via --chown.
mkdir -p "$WORK/docker/app/storage"
touch "$WORK/docker/app/storage/.gitkeep"
echo "webserver jar staged: $(basename "$EXE") -> docker/app/kestra"

echo "== extension artifacts (from extension repos; see build-extensions.sh) =="
bash scripts/build-extensions.sh "$WORK"

echo "== build image (upstream Dockerfile.base/Dockerfile unmodified) =="
# Multi-platform (amd64+arm64) needs a buildx builder with the docker-container driver
# (the default docker driver cannot build multi-platform manifests).
if ! docker buildx inspect kestra-overlay-builder >/dev/null 2>&1; then
  docker buildx create --name kestra-overlay-builder --driver docker-container --use
fi
docker buildx use kestra-overlay-builder
# Image lineage: zero plugin/extension jars are baked (extensions.tsv has no
# active plugin/classpath rows; build-extensions.sh leaves $WORK/plugins empty)
# — the same content family as upstream's slim/no-plugins variants. Main tag
# suffix "-no-plugins" (maintainer naming ruling 2026-10-07). One deliberate
# difference from the upstream no-plugins variant: we bake NO Kestra config,
# so auto-install keeps its source default (OSS + storage.type=local => on),
# whereas upstream's no-plugins bakes it off. Deployments wanting the hardened
# behavior set it explicitly via KESTRA_CONFIGURATION (channel ④, restart).
# Candidate promotion is performed only after all image acceptance gates pass.
METADATA="$WORK/overlay-image-metadata.json"
docker buildx build -f "$WORK/Dockerfile" \
  --build-arg "BASE_IMAGE=$IMAGE_BASE" \
  --metadata-file "$METADATA" \
  --platform linux/amd64,linux/arm64 \
  -t "$CANDIDATE_TAG" --push "$WORK"
DIGEST=$(node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const digest=data["containerimage.digest"];if(!/^sha256:[0-9a-f]{64}$/.test(digest||""))process.exit(1);process.stdout.write(digest)' "$METADATA")
CANDIDATE_IMAGE="${IMAGE_REPOSITORY}@${DIGEST}"
printf '%s\n' "$CANDIDATE_IMAGE" > "$WORK/overlay-candidate-image"
echo "Candidate image: $CANDIDATE_IMAGE"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'image=%s\n' "$CANDIDATE_IMAGE" >> "$GITHUB_OUTPUT"
fi
