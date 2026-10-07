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
# below is retained as machinery only — the registry carries no rows using it,
# and adding one requires revisiting the positioning ruling first.
#
# The extension registry lives in extensions.tsv (name | slot | note) — this
# script is client-neutral machinery; downstream repos are data, not code
# (AGENTS.md §0 north star). Slot semantics map to the channel matrix in
# docs/extension-mechanisms.md §0:
#   plugin     -> channel ③: report-only under the zero-jar positioning
#                 (deployments volume-mount /app/plugins + restart)
#   classpath  -> channel ②: jar must be on the application classpath (beans
#                 join the Micronaut context). Delivery depends on
#                 R-CLASSPATH-MERGE (docs/extension-mechanisms.md §4): until
#                 it lands these are reported PENDING and NOT injected — the
#                 plugins/ slot cannot carry @Controller/@Filter beans (F3).
#   standalone -> separate process/image built by its own repo CI; not baked
#                 into the kestra image.
#
# Jar sources (for the legacy staging machinery) are prebuilt artifacts from
# the extension repos; source priority per extension (first hit wins):
#   1) EXT_JAR_<NAME_UPPER_UNDERSCORED> env var -> path to a jar file or a dir of jars
#   2) $PWD/extensions/<name>/                   -> repo checkout; jars discovered under it
#   3) otherwise                                  -> skipped, reported NOT INJECTED
#
# No binaries are vendored in this repo: jars come only from extension-repo
# built artifacts (env var or extensions/ dir). The injection manifest is
# written to $WORK/.overlay-extensions.json; the official Dockerfile bakes
# whatever is staged under $WORK/plugins/ (expected: nothing).
set -euo pipefail

WORK="${1:?worktree path required}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="$REPO/extensions.tsv"
PLUGINS_DIR="$WORK/plugins"
mkdir -p "$PLUGINS_DIR"

[ -f "$REGISTRY" ] || { echo "FAIL: registry missing: $REGISTRY" >&2; exit 1; }

MANIFEST_TMP="$WORK/.overlay-extensions.tmp"
: > "$MANIFEST_TMP"

echo "== extension injection (registry: extensions.tsv) =="

# registry rows: name | slot | note (comments/blank lines skipped)
awk -F'\t' '/^#/ || /^$/ {next} {print $1 "\t" $2}' "$REGISTRY" | while IFS="$(printf '\t')" read -r name slot; do
  case "$slot" in
    standalone)
      echo "  - $name: standalone image (own repo CI), not baked into kestra image"
      echo "$name|standalone" >> "$MANIFEST_TMP"
      ;;
    classpath)
      # Channel ② delivery is gated on R-CLASSPATH-MERGE; the plugins/ slot
      # cannot carry controller/filter beans, so staging there would be a
      # silent no-op — report PENDING instead (2026-10-07 cleanup).
      echo "  - $name: PENDING R-CLASSPATH-MERGE (channel-2 jar not deliverable yet; plugins/ slot cannot carry @Controller/@Filter)"
      echo "$name|classpath-pending" >> "$MANIFEST_TMP"
      ;;
    plugin)
      src="$(printenv "EXT_JAR_$(echo "$name" | tr 'a-z' 'A-Z' | tr '-' '_')" 2>/dev/null || true)"
      jar_src=""
      if [ -n "$src" ]; then
        jar_src="$src"
      elif [ -d "$REPO/extensions/$name" ]; then
        jar_src="$REPO/extensions/$name"
      fi
      if [ -z "$jar_src" ]; then
        echo "  - $name: NOT INJECTED (no artifacts; set EXT_JAR_* or extensions/$name)"
        continue
      fi
      if [ -f "$jar_src" ]; then
        cp "$jar_src" "$PLUGINS_DIR/"
        echo "  + $name: staged jar $(basename "$jar_src")"
      else
        # dir: copy jars (one level: dir/*.jar and dir/build/libs/*.jar)
        found=0
        for j in "$jar_src"/*.jar "$jar_src"/build/libs/*.jar; do
          if [ -f "$j" ]; then
            cp "$j" "$PLUGINS_DIR/"
            echo "  + $name: staged $(basename "$j")"
            found=1
          fi
        done
        if [ "$found" = "0" ]; then
          echo "  - $name: NO jars found under $jar_src (extension build pending)"
          continue
        fi
      fi
      echo "$name|$PLUGINS_DIR" >> "$MANIFEST_TMP"
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
echo "== extension injection done: registry ${total} entries, staged plugin jars: ${staged} =="
