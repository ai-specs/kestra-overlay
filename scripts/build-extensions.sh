#!/usr/bin/env bash
# build-extensions.sh — extension-repo injection (kestra-overlay side)
# bash 3.2 compatible (macOS default).
#
# Of the 9 extension repos (excluding the two overlay repos themselves),
# the kestra-side four — extensions OF upstream kestra-io/kestra — participate
# in the kestra image / image family as follows:
#
#   plugin-apps-harness   -> kestra plugin jar  -> $WORK/locals/plugins/   (Dsh* security surface 13/13)
#   plugin-apps-amis      -> kestra plugin jar  -> $WORK/locals/plugins/   (declarative Amis apps triggers)
#   kestra-oidc-provider  -> standalone IdP app (separate image, own repo CI; not baked into kestra image)
#   plugin-relay-dsh      -> standalone relay app (separate image, own repo CI; not baked into kestra image)
#
# Jar sources are prebuilt artifacts from the extension repos (their CI builds
# and publishes jars); this script only collects and stages them. Source priority
# per extension (first hit wins):
#   1) EXT_JAR_<NAME_UPPER_UNDERSCORED> env var -> path to a jar file or a dir of jars
#   2) $PWD/extensions/<name>/                    -> repo checkout; jars discovered under it
#   3) $PWD/locals/plugins/<name>/                -> staged artifacts already vendored here
#   4) otherwise                                  -> skipped, reported NOT INJECTED
#
# The injection manifest is written to $WORK/.overlay-extensions.json; the
# Dockerfile (patched to COPY locals/plugins -> /app/plugins) bakes whatever is
# staged. Skeleton state: locals/plugins carries the bootstrap Dsh* jar from the
# pilot repo (plugin-apps-harness), so the image already contains the security
# surface while other extension repos are still migrating.
set -euo pipefail

WORK="${1:?worktree path required}"
PWD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGINS_DIR="$WORK/locals/plugins"
mkdir -p "$PLUGINS_DIR"

# name -> jar-staged (1) or standalone-app (0)
NAMES=(plugin-apps-harness plugin-apps-amis kestra-oidc-provider plugin-relay-dsh)
IN_IMAGE=(1 1 0 0)

MANIFEST_TMP="$WORK/.overlay-extensions.tmp"
: > "$MANIFEST_TMP"
INJECTED_COUNT=0

echo "== extension injection (kestra-side extension repos) =="
i=0
for name in "${NAMES[@]}"; do
  in_image="${IN_IMAGE[$i]}"
  i=$((i+1))
  envkey="EXT_JAR_$(echo "$name" | tr 'a-z' 'A-Z' | tr '-' '_')"
  src="$(printenv "$envkey" 2>/dev/null || true)"

  if [ "$in_image" = "0" ]; then
    echo "  - $name: standalone image (own repo CI), not baked into kestra image"
    echo "$name|standalone" >> "$MANIFEST_TMP"
    continue
  fi

  # jar source resolution
  jar_src=""
  if [ -n "$src" ]; then
    jar_src="$src"
  elif [ -d "$PWD_DIR/extensions/$name" ]; then
    jar_src="$PWD_DIR/extensions/$name"
  elif [ -d "$PWD_DIR/locals/plugins/$name" ]; then
    jar_src="$PWD_DIR/locals/plugins/$name"
  fi

  if [ -z "$jar_src" ]; then
    echo "  - $name: NOT INJECTED (no artifacts; repo migration pending)"
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
    # vendored staging (locals/plugins/<name>/*.jar already in place) -> keep as-is
    if [ -d "$PWD_DIR/locals/plugins/$name" ] && [ "$found" = "0" ]; then
      echo "  + $name: vendored staging dir kept ($PWD_DIR/locals/plugins/$name)"
      found=1
    fi
    if [ "$found" = "0" ]; then
      echo "  - $name: NO jars found under $jar_src (extension build pending)"
      continue
    fi
  fi

  echo "$name|$PLUGINS_DIR" >> "$MANIFEST_TMP"
  INJECTED_COUNT=$((INJECTED_COUNT+1))
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

echo "== extension injection done: $INJECTED_COUNT jar-injected, ${#NAMES[@]} extensions defined =="
echo "== staged plugin jars: $(ls "$PLUGINS_DIR" | wc -l | tr -d ' ') =="
