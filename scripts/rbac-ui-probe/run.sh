#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
work_dir="$script_dir/../../.work/rbac-ui-probe"
mkdir -p "$work_dir"
cp "$script_dir"/{package.json,index.html,extension.js,harness.js,probe.css,vite.config.js,language.html,language.js,shadow-build.mjs,phase1-extension.js} "$work_dir/"
cd "$work_dir"
run_check() {
    local label="$1"
    shift
    local result=0
    "$@" > "$label.log" 2>&1 || result=$?
    printf '%s exit=%s\n' "$label" "$result" | tee -a checks.log
    return "$result"
}
run_check install npm install --registry=https://registry.npmjs.org
if [[ "${1:-}" == "--phase1" ]]; then
    run_check phase1-build node shadow-build.mjs --phase1
    mkdir -p jar-content/ui/probe/phase1
    cp -R phase1/. jar-content/ui/probe/phase1/
else
    run_check build node node_modules/vite/bin/vite.js build
fi
mkdir -p jar-content/ui/probe
cp "$script_dir/static-probe.js" jar-content/ui/probe/page.js
run_check jar jar --create --file static-probe.jar -C jar-content .
run_check compose-config docker compose -p rbac-ui-probe -f "$script_dir/compose.yaml" config --quiet
printf 'Start isolated host: docker compose -p rbac-ui-probe -f %q up -d\n' "$script_dir/compose.yaml"
printf 'Serve build: cd %q && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5198 --strictPort\n' "$work_dir"
