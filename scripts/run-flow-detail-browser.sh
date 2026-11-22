#!/usr/bin/env bash
# Explicit native host test transport, no production identity or PostgreSQL.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:?host source tree required}"
OUTPUT="${2:?evidence directory required}"
mkdir -p "$OUTPUT"
WORK="$(cd "$WORK" && pwd)"
OUTPUT="$(cd "$OUTPUT" && pwd)"
cd "$WORK/ui"
FLOW_DETAIL_RUN_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
FLOW_DETAIL_SOURCE_HASH="$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync("tests/flow-detail-capabilities/serve.mjs")).digest("hex"))')"
export FLOW_DETAIL_RUN_ID
# Predeclare the exact matrix before starting the transport, so startup/driver failures retain notRun cases.
node --input-type=module - "$OUTPUT" "$REPO" <<'JS'
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const area=path.resolve('tests/flow-detail-capabilities');const {CASE_NAMES,SOURCE_PATHS}=await import(path.join(area,'cases.mjs'));
const [output,repo]=process.argv.slice(2),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const inputs=Object.fromEntries(SOURCE_PATHS.map(p=>[p,sha(path.resolve(area,p))]));inputs['overlay:sdk-browser-diagnostics.cjs']=sha(path.join(repo,'scripts/sdk-browser-diagnostics.cjs'));
fs.writeFileSync(path.join(output,'browser.json'),JSON.stringify({completed:false,passedGate:false,transport:'explicit-test-transport',phase:'transport-startup',inputs,cases:CASE_NAMES.map(name=>({name,status:'notRun'})),notRun:CASE_NAMES.length},null,2)+'\n');
const patches=execFileSync('git',['-C',repo,'ls-files','--cached','--others','--exclude-standard','patches'],{encoding:'utf8'}).trim().split('\n').filter(p=>p.endsWith('.patch'));
fs.writeFileSync(path.join(output,'inputs.json'),JSON.stringify({transportRunId:process.env.FLOW_DETAIL_RUN_ID,overlayCommit:execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),base:fs.readFileSync(path.join(repo,'patches/BASE'),'utf8'),patches:Object.fromEntries(patches.map(p=>[p,sha(path.join(repo,p))])),runnerSha256:sha(path.join(repo,'scripts/run-flow-detail-browser.sh')),sources:inputs},null,2)+'\n');
const hostRoot=path.resolve('..');
for(const relative of SOURCE_PATHS){const input=path.resolve(area,relative),hostRelative=path.relative(hostRoot,input);if(hostRelative.startsWith('..'))throw new Error('Source escapes host tree');const destination=path.join(output,'source/host',hostRelative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(input,destination)}
for(const name of ['sdk-browser-diagnostics.cjs','run-flow-detail-browser.sh','check-native-flow-detail-artifact.py']){const destination=path.join(output,'source/overlay/scripts',name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(repo,'scripts',name),destination)}
JS
node <<'JS'
const net=require('node:net');const server=net.createServer();
server.on('error',error=>{console.error('Port 5189 unavailable; refusing to use or kill another server:',error.code);process.exitCode=1});
server.listen(5189,'127.0.0.1',()=>server.close());
JS
node --test --test-reporter=junit tests/flow-detail-capabilities/diagnostics.test.mjs tests/flow-detail-capabilities/check-report.test.mjs > "$OUTPUT/evidence-regression.xml" 2> "$OUTPUT/evidence-regression.log"
node tests/flow-detail-capabilities/serve.mjs > "$OUTPUT/server.log" 2>&1 &
FLOW_DETAIL_SERVER_PID=$!
trap 'kill "$FLOW_DETAIL_SERVER_PID" 2>/dev/null || true' EXIT
for attempt in $(seq 1 60); do
  if ! kill -0 "$FLOW_DETAIL_SERVER_PID" 2>/dev/null; then cat "$OUTPUT/server.log"; exit 1; fi
  if curl --fail --silent http://127.0.0.1:5189/test/evidence > "$OUTPUT/readiness.json"; then
    node - "$OUTPUT/readiness.json" "$FLOW_DETAIL_RUN_ID" "$FLOW_DETAIL_SOURCE_HASH" <<'JS'
const fs=require('node:fs'),state=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(state.runId!==process.argv[3]||state.sourceHash!==process.argv[4])throw new Error('Detail transport owner/source mismatch');
JS
    kill -0 "$FLOW_DETAIL_SERVER_PID" 2>/dev/null || { cat "$OUTPUT/server.log"; exit 1; }
    break
  fi
  if [ "$attempt" = 60 ]; then echo 'Detail transport did not start'; exit 1; fi
  sleep 1
done
node --test tests/flow-execution-capabilities/wait-for-condition.test.mjs > "$OUTPUT/driver-unit.log" 2>&1
node tests/flow-detail-capabilities/playwright.mjs "$OUTPUT" "$REPO/scripts/sdk-browser-diagnostics.cjs" > "$OUTPUT/driver.log" 2>&1
node tests/flow-detail-capabilities/check-report.mjs "$OUTPUT/browser.json" "$REPO/scripts/sdk-browser-diagnostics.cjs" > "$OUTPUT/check.json"

python3 "$REPO/scripts/check-native-flow-detail-artifact.py" "$OUTPUT" > "$OUTPUT/artifact-check.json"
