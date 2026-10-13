#!/usr/bin/env bash
# build-extensions.sh — extension-repo injection (kestra-overlay side)
# bash 3.2 compatible (macOS default).
#
# POSITIONING (2026-10-07 maintainer ruling): the overlay image bakes ZERO
# external jars at build time (hardened, no-plugins lineage — see
# docs/extension-mechanisms.md F4). Extension jars are ALWAYS provisioned by
# the deployment side: plugin slot -> volume-mounted /app/plugins + restart
# (channel ③); classpath slot -> manifest Class-Path entries injected by
# build.sh into the executable jar (metadata only, R-CLASSPATH-MERGE) with the
# jar bodies mounted at /app/libs (channel ②). The plugin-slot staging path
# is unavailable: all plugin bodies are supplied by the deployment.
#
# The extension registry lives in extensions.tsv (name | slot | note) — this
# script is client-neutral machinery; downstream repos are data, not code
# (AGENTS.md §0 north star). Slot semantics map to the channel matrix in
# docs/extension-mechanisms.md §0:
#   plugin     -> channel ③: report-only under the zero-jar positioning
#                 (deployments volume-mount /app/plugins + restart)
#   classpath  -> channel ②: jar must be on the application classpath (beans
#                 join the Micronaut context). Delivery depends on
#                 R-CLASSPATH-MERGE (docs/extension-mechanisms.md §4): metadata is injected by build/local-ci; jar bodies are NOT staged — the
#                 plugins/ slot cannot carry @Controller/@Filter beans (F3).
#   standalone -> separate process/image built by its own repo CI; not baked
#                 into the kestra image.
#
# This script reads only the local extension registry. It never reads sibling
# repositories, environment-selected artifacts or extension jar bytes.
# Every extension body is supplied by the deployment after this image is published.
set -euo pipefail

WORK="${1:?worktree path required}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="$REPO/extensions.tsv"
PLUGINS_DIR="$WORK/plugins"
mkdir -p "$PLUGINS_DIR"
# Reject leftovers rather than allowing the upstream Dockerfile to bake them.
if find "$PLUGINS_DIR" -type f -name '*.jar' -print -quit | grep -q .; then
  echo 'FAIL: external plugin jars must not be present in the image build directory' >&2
  exit 1
fi

[ -f "$REGISTRY" ] || { echo "FAIL: registry missing: $REGISTRY" >&2; exit 1; }

MANIFEST_TMP="$WORK/.overlay-extensions.tmp"
: > "$MANIFEST_TMP"

echo "== extension deployment contracts (registry: extensions.tsv) =="

# registry rows: name | slot | note (comments/blank lines skipped)
awk -F'\t' '/^#/ || /^$/ {next} {print $1 "\t" $2}' "$REGISTRY" | while IFS="$(printf '\t')" read -r name slot; do
  case "$slot" in
    standalone)
      echo "  - $name: standalone image (own repo CI), not baked into kestra image"
      echo "$name|standalone" >> "$MANIFEST_TMP"
      ;;
    classpath)
      # Channel ② metadata is injected into the staged executable by the caller.
      # Jar bodies remain deployment-owned; plugins/ cannot carry these beans.
      echo "  - $name: runtime mount /app/libs/$name.jar (manifest contract injected by build/local-ci; zero jar bytes staged)"
      echo "$name|classpath-runtime-mount" >> "$MANIFEST_TMP"
      ;;
    plugin)
      echo "  - $name: runtime mount /app/plugins (zero jar bytes staged)"
      echo "$name|plugin-runtime-mount" >> "$MANIFEST_TMP"
      ;;
    *)
      echo "FAIL: unknown slot '$slot' for $name in extensions.tsv" >&2
      exit 1
      ;;
  esac
done

python3 - "$WORK/.overlay-extensions.json" "$MANIFEST_TMP" <<'PYEOF'
import json, sys
manifest_path, tmp_path = sys.argv[1], sys.argv[2]
entries = []
with open(tmp_path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        name, _, role = line.partition("|")
        entries.append({"name": name, "role": role})
with open(manifest_path, "w") as f:
    json.dump({"injected": entries}, f, indent=2)
    f.write("\n")
print("  manifest: %s (%d entries)" % (manifest_path, len(entries)))
PYEOF
rm -f "$MANIFEST_TMP"

total=$(awk -F'\t' '/^#/ || /^$/ {next} {n++} END {print n+0}' "$REGISTRY")
staged=$(ls "$PLUGINS_DIR" | wc -l | tr -d ' ')
echo "== extension deployment contracts done: registry ${total} entries, staged plugin jars: ${staged} =="
