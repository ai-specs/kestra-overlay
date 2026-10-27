#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:?usage: blackbox-mcp-oauth.sh IMAGE [verify-tree]}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${2:-$REPO/.work/verify}"
PORT="${BB_MCP_PORT:-18086}"
BASE="http://localhost:$PORT"
NET="overlay-mcp-bb-$$"
RESOURCE_OWNER="${BB_RESOURCE_OWNER:-$NET}"
PG="overlay-mcp-pg-$$"
APP="overlay-mcp-app-$$"
TEMP_DIR=$(mktemp -d)
REPORT_DIR="${BB_REPORT_DIR:-}"
SDK_RUN=0
preserve_report() {
  if [ -n "$REPORT_DIR" ] && [ -f "$2" ]; then
    mkdir -p "$REPORT_DIR"
    cp "$2" "$REPORT_DIR/$1.xml"
  fi
}
cleanup() {
  local code=$?
  if [ "$code" != 0 ]; then
    docker inspect -f 'MCP acceptance container: status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}}' "$APP" 2>/dev/null || true
    docker logs --tail 600 "$APP" 2>&1 | python3 -c 'import re,sys; [print("[redacted credential-bearing line]" if re.search(r"token|password|secret|cookie|authorization|Bearer|state=|code=|eyJ[A-Za-z0-9_-]+\.", line, re.I) else line, end="" if line.endswith("\n") else "\n") for line in sys.stdin]' || true
  fi
  while read -r container; do docker rm -f "$container" >/dev/null 2>&1 || true; done < <(docker ps -aq --filter "label=owner=$RESOURCE_OWNER" --filter "label=run=$NET")
  while read -r network; do docker network rm "$network" >/dev/null 2>&1 || true; done < <(docker network ls -q --filter "label=owner=$RESOURCE_OWNER" --filter "label=run=$NET")
  rm -rf "$TEMP_DIR"
  return "$code"
}
trap cleanup EXIT
docker network create --label "owner=$RESOURCE_OWNER" --label "run=$NET" "$NET" >/dev/null
docker run -d --label "owner=$RESOURCE_OWNER" --label "run=$NET" --name "$PG" --network "$NET" -p 127.0.0.1::5432 -e POSTGRES_DB=kestra -e POSTGRES_USER=kestra -e POSTGRES_PASSWORD=local-ci-only "${BB_PG_IMAGE:-postgres:18}" >/dev/null
cat > "$TEMP_DIR/config.yml" <<EOF
datasources:
  postgres:
    url: jdbc:postgresql://$PG:5432/kestra
    driverClassName: org.postgresql.Driver
    username: kestra
    password: local-ci-only
kestra:
  url: $BASE/
  repository:
    type: postgres
  queue:
    type: postgres
  storage:
    type: local
    local:
      base-path: /app/storage
  plugins:
    auto-install:
      enabled: false
  oidc:
    enabled: true
    issuer: $BASE
    registration:
      enabled: true
      max-pending-clients: 20
      requests-per-minute: 100
micronaut:
  security:
    enabled: true
    authentication: idtoken
    filter:
      enabled: true
    intercept-url-map:
      - pattern: /oidc/**
        access: [isAnonymous()]
      - pattern: /.well-known/**
        access: [isAnonymous()]
      - pattern: /oauth/**
        access: [isAnonymous()]
      - pattern: /**
        access: [isAuthenticated()]
    oauth2:
      clients:
        kestra:
          client-id: ci-ui
          client-secret: local-ci-ui-only
          scopes: [openid, profile, email]
          openid:
            issuer: $BASE
            token:
              url: http://localhost:8080/oidc/token
            jwks-uri: http://localhost:8080/oidc/jwks
EOF
PG_READY=0
for attempt in $(seq 1 30); do
  if docker exec "$PG" pg_isready -U kestra >/dev/null 2>&1; then PG_READY=1; break; fi
  sleep 1
done
[ "$PG_READY" = 1 ] || { echo 'FAIL PostgreSQL readiness timeout'; exit 1; }
docker run -d --label "owner=$RESOURCE_OWNER" --label "run=$NET" --name "$APP" --network "$NET" -p "$PORT:8080" -e KESTRA_CONFIGURATION="$(cat "$TEMP_DIR/config.yml")" \
  -e KESTRA_OIDC_BOOTSTRAP_USERNAME=tester -e 'KESTRA_OIDC_BOOTSTRAP_PASSWORD=Passw0rd!' \
  "$IMAGE" server standalone >/dev/null
READY=0
for attempt in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Running}}' "$APP")" = true ] || { echo 'FAIL MCP container exited during startup'; exit 1; }
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)" = 200 ]; then READY=1; break; fi
  sleep 2
done
[ "$READY" = 1 ] || { echo 'FAIL MCP instance startup'; exit 1; }
node "$REPO/scripts/blackbox-mcp-oauth.mjs" "$BASE" "$TEMP_DIR"
HASHED_UI_CLIENT=$(docker exec "$PG" psql -U kestra -Atc "SELECT count(*) FROM oidc_client WHERE client_id='ci-ui' AND secret_format='pbkdf2-sha256-v1' AND client_secret <> 'local-ci-ui-only'")
[ "$HASHED_UI_CLIENT" = 1 ] || {
  docker exec "$PG" psql -U kestra -Atc "SELECT client_id,secret_format,client_secret='local-ci-ui-only' AS is_plaintext,client_secret LIKE '{pbkdf2-sha256-v1}%' AS is_hash FROM oidc_client"
  echo 'FAIL bootstrap client secret was not hashed'; exit 1;
}
echo 'PASS production bootstrap stores a versioned hash instead of the UI client secret'
if [ "${MCP_PRISTINE_PROBE:-0}" = 1 ]; then exit 0; fi
PG_PORT=$(docker port "$PG" 5432/tcp | sed 's/.*://')
FIXTURE_EXIT=0
(cd "$WORK" && OIDC_FIXTURE_JDBC="jdbc:postgresql://127.0.0.1:$PG_PORT/kestra" \
  ./gradlew :webserver:test --rerun --tests io.kestra.webserver.oidc.OidcSecondUserFixtureTest --console=plain) || FIXTURE_EXIT=$?
preserve_report fixture-second-user "$WORK/webserver/build/test-results/test/TEST-io.kestra.webserver.oidc.OidcSecondUserFixtureTest.xml"
[ "$FIXTURE_EXIT" = 0 ] || exit "$FIXTURE_EXIT"
grep -q 'tests="1" skipped="0" failures="0" errors="0"' "$WORK/webserver/build/test-results/test/TEST-io.kestra.webserver.oidc.OidcSecondUserFixtureTest.xml"
node "$REPO/scripts/blackbox-mcp-second-user.mjs" "$BASE" "$TEMP_DIR"
sdk() {
  SDK_RUN=$((SDK_RUN+1))
  local sdk_exit=0
  (cd "$WORK" && MCP_INSTANCE_URL="$BASE" MCP_TOKEN_FILE="$TEMP_DIR/$1" MCP_CALL_TOOL=overlay-acceptance MCP_EXPECT_CALL_ERROR="$2" \
    ./gradlew :webserver:test --rerun --tests io.kestra.webserver.oidc.McpSdkInstanceTest --console=plain) || sdk_exit=$?
  RESULT="$WORK/webserver/build/test-results/test/TEST-io.kestra.webserver.oidc.McpSdkInstanceTest.xml"
  preserve_report "sdk-$SDK_RUN-${1%.json}" "$RESULT"
  [ "$sdk_exit" = 0 ] || return "$sdk_exit"
  test -f "$RESULT"
  grep -q 'tests="1" skipped="0" failures="0" errors="0"' "$RESULT" || { echo 'FAIL SDK acceptance skipped or failed'; exit 1; }
}
sdk full.json false
COUNT=$(docker exec "$PG" psql -U kestra -Atc "SELECT count(*) FROM executions WHERE value->>'flowId'='mcp-acceptance' AND value->'state'->>'current'='SUCCESS'")
[ "$COUNT" = 1 ] || { echo 'FAIL successful execution missing'; exit 1; }
sdk read.json true
COUNT=$(docker exec "$PG" psql -U kestra -Atc "SELECT count(*) FROM executions WHERE value->>'flowId'='mcp-acceptance'")
[ "$COUNT" = 1 ] || { echo 'FAIL denied call created execution'; exit 1; }
node "$REPO/scripts/blackbox-mcp-lifecycle.mjs" "$BASE" "$TEMP_DIR"
QUOTA_REJECTED=0
for attempt in $(seq 1 25); do
  STATUS=$(curl -sS -o "$TEMP_DIR/quota.json" -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -d '{"redirect_uris":["http://127.0.0.1:19999/callback"],"token_endpoint_auth_method":"none"}' \
    "$BASE/oidc/register")
  case "$STATUS" in
    201) ;;
    429) QUOTA_REJECTED=1; break ;;
    *) echo "FAIL pending quota returned unexpected HTTP $STATUS"; exit 1 ;;
  esac
done
PENDING_COUNT=$(docker exec "$PG" psql -U kestra -Atc "SELECT count(*) FROM oidc_client WHERE client_kind='pending' AND pending_expires_at>now()")
[ "$QUOTA_REJECTED" = 1 ] && [ "$PENDING_COUNT" = 20 ] || { echo 'FAIL pending quota saturation was not enforced'; exit 1; }
echo 'PASS pending registration saturation returns 429 at the configured database quota'
COUNT=$(docker exec "$PG" psql -U kestra -Atc "SELECT count(*) FROM executions WHERE value->>'flowId'='mcp-acceptance'")
[ "$COUNT" = 1 ] || { echo 'FAIL revoked session created execution'; exit 1; }
docker rm -f "$APP" >/dev/null
printf '\nkestra.mcp.rbac.enabled: true\n' >> "$TEMP_DIR/config.yml"
docker run -d --label "owner=$RESOURCE_OWNER" --label "run=$NET" --name "$APP" --network "$NET" -p "$PORT:8080" -e KESTRA_CONFIGURATION="$(cat "$TEMP_DIR/config.yml")" \
  "$IMAGE" server standalone >/dev/null
READY=0
for attempt in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Running}}' "$APP")" = true ] || { echo 'FAIL RBAC instance exited'; exit 1; }
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)" = 200 ]; then READY=1; break; fi
  sleep 2
done
[ "$READY" = 1 ] || { echo 'FAIL RBAC readiness'; exit 1; }
RBAC_EXIT=0
(cd "$WORK" && MCP_INSTANCE_URL="$BASE" MCP_TOKEN_FILE="$TEMP_DIR/rbac.json" MCP_EXPECT_TOOLS_EMPTY=true MCP_CALL_TOOL=overlay-acceptance MCP_EXPECT_HIDDEN_CALL=true \
  ./gradlew :webserver:test --rerun --tests io.kestra.webserver.oidc.McpSdkInstanceTest --console=plain) || RBAC_EXIT=$?
preserve_report sdk-rbac-missing-authorizer "$WORK/webserver/build/test-results/test/TEST-io.kestra.webserver.oidc.McpSdkInstanceTest.xml"
[ "$RBAC_EXIT" = 0 ] || exit "$RBAC_EXIT"
grep -q 'tests="1" skipped="0" failures="0" errors="0"' "$WORK/webserver/build/test-results/test/TEST-io.kestra.webserver.oidc.McpSdkInstanceTest.xml"
COUNT=$(docker exec "$PG" psql -U kestra -Atc "SELECT count(*) FROM executions WHERE value->>'flowId'='mcp-acceptance'")
[ "$COUNT" = 1 ] || { echo 'FAIL RBAC unavailable created execution'; exit 1; }
echo 'PASS RBAC enabled without Authorizer hides tools and creates no execution'
echo 'MCP BLACKBOX ALL GREEN: real SDK success and scope deny with zero new executions'
