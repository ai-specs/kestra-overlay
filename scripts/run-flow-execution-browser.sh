#!/usr/bin/env bash
# Native host component gate; explicit test transport, no production identity or PostgreSQL.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:?host source tree required}"
OUTPUT="${2:?evidence directory required}"
mkdir -p "$OUTPUT"
WORK="$(cd "$WORK" && pwd)"
OUTPUT="$(cd "$OUTPUT" && pwd)"
cd "$WORK/ui"
node <<'JS'
const net=require("node:net");const server=net.createServer();
server.on("error",error=>{console.error("Port 5178 unavailable; refusing to use or kill another server:",error.code);process.exitCode=1});
server.listen(5178,"127.0.0.1",()=>server.close());
JS
FLOW_BROWSER_RUN_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
FLOW_BROWSER_SOURCE_HASH="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync("tests/flow-execution-capabilities/serve.mjs")).digest("hex"))')"
export FLOW_BROWSER_RUN_ID
node tests/flow-execution-capabilities/serve.mjs > "$OUTPUT/server.log" 2>&1 &
FLOW_BROWSER_SERVER_PID=$!
trap 'kill "$FLOW_BROWSER_SERVER_PID" 2>/dev/null || true' EXIT
for attempt in $(seq 1 60); do
  if ! kill -0 "$FLOW_BROWSER_SERVER_PID" 2>/dev/null; then cat "$OUTPUT/server.log"; exit 1; fi
  if curl --fail --silent http://127.0.0.1:5178/test/evidence > "$OUTPUT/readiness.json"; then
    node - "$OUTPUT/readiness.json" "$FLOW_BROWSER_RUN_ID" "$FLOW_BROWSER_SOURCE_HASH" <<'JS'
const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if(value.runId!==process.argv[3]||value.sourceHash!==process.argv[4])throw new Error("Readiness server owner or source mismatch");
JS
    kill -0 "$FLOW_BROWSER_SERVER_PID" 2>/dev/null || { cat "$OUTPUT/server.log"; exit 1; }
    break
  fi
  if [ "$attempt" = 60 ]; then echo 'Native Flow browser transport did not start'; exit 1; fi
  sleep 1
done
node tests/flow-execution-capabilities/playwright.mjs "$OUTPUT" "$REPO/scripts/sdk-browser-diagnostics.cjs" > "$OUTPUT/driver.log" 2>&1
node tests/flow-execution-capabilities/check-report.mjs "$OUTPUT/browser.json" "$REPO/scripts/sdk-browser-diagnostics.cjs" > "$OUTPUT/check.json"
