#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TREE="${1:?compiled own upstream tree required}"
OUT="${2:?evidence directory required}"
mkdir -p "$OUT"
export OIDC_ONBOARDING_BROWSER_DRIVER=node
export OIDC_ONBOARDING_BROWSER_RUNNER="$ROOT/scripts/onboarding-playwright-runner.mjs"
export OIDC_ONBOARDING_BROWSER_SCRIPT="$ROOT/scripts/onboarding-browser-cases.mjs"
export OIDC_ONBOARDING_BROWSER_REPORT="$OUT/report.json"
export OIDC_ONBOARDING_BROWSER_INPUTS="$OUT/inputs.json"
export OIDC_ONBOARDING_UI_ROOT="$TREE/webserver/build/resources/main/ui"
export OIDC_ONBOARDING_TEST_OUTPUT="$OUT/http-tests"
node "$ROOT/scripts/write-onboarding-browser-inputs.mjs"
cp "$OUT/inputs.json" "$OUT/before-inputs.json"
code=0
(cd "$TREE" && ./gradlew --init-script "$ROOT/scripts/onboarding-test.init.gradle" :webserver:processResources :webserver:test --tests io.kestra.webserver.oidc.OidcInitialAccountHttpTest --console=plain) > "$OUT/service.log" 2>&1 || code=$?
export OIDC_ONBOARDING_BROWSER_INPUTS="$OUT/final-inputs.json"
node "$ROOT/scripts/write-onboarding-browser-inputs.mjs"
cmp "$OUT/inputs.json" "$OUT/final-inputs.json"
node "$ROOT/scripts/check-onboarding-browser.mjs" "$OUT/report.json"
exit "$code"
