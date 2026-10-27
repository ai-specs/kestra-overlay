#!/usr/bin/env bash
set -euo pipefail
scripts="$(cd "$(dirname "$0")" && pwd)"
tree="${SDK_DEV_TREE:-$scripts/../../.work/access-control-v3-sdk-dev}"
work="$tree/sdk-probe"
mkdir -p "$work"
cp "$scripts"/sdk-{components.js,shell.js,build.mjs} "$scripts/sdk.html" "$work/"
cp "$scripts/sdk-browser-matrix.mjs" "$work/"
cp "$scripts/sdk-evidence.mjs" "$work/"
cp "$scripts/sdk-theme.mjs" "$work/"
cp "$scripts/sdk-package.json" "$work/package.json"
cp "$scripts/sdk-package-lock.json" "$work/package-lock.json"
cd "$work"
if [[ -L node_modules ]]; then
  node --input-type=module -e 'import fs from "node:fs"; const lock=JSON.parse(fs.readFileSync("package-lock.json")); const installed=JSON.parse(fs.readFileSync("node_modules/.package-lock.json")); for(const [name,entry] of Object.entries(installed.packages)){if(!name)continue;const expected=lock.packages[name];if(!expected||entry.version!==expected.version||entry.integrity!==expected.integrity)throw Error("Shared read-only cache differs: "+name);} for(const [name,entry] of Object.entries(lock.packages)){if(!name||!fs.existsSync(name+"/package.json"))continue;const actual=JSON.parse(fs.readFileSync(name+"/package.json"));if(actual.version!==entry.version)throw Error("Installed version differs: "+name);}'
else
  npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
fi
node --input-type=module -e 'import fs from "node:fs"; const expected=JSON.parse(fs.readFileSync("package.json")); for(const [name,version] of Object.entries(expected.dependencies)){const actual=JSON.parse(fs.readFileSync("node_modules/"+name+"/package.json")).version;if(actual!==version)throw new Error(name+": expected "+version+", received "+actual);}'
SDK_DEV_TREE="$tree" node sdk-build.mjs
printf '\nStatic probe: cd %q && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5199 --strictPort --outDir dist\n' "$work"
printf 'URL: http://127.0.0.1:5199/sdk/items\nRaw public-component reproduction: http://127.0.0.1:5199/sdk/items?raw=1\n'
