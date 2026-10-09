#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?usage: blackbox-ui-oidc.sh <image-ref>}"
PORT="${BB_UI_PORT:-18081}"
BASE="http://localhost:$PORT"
NET="kestra-ui-bb-$$"
PG="kestra-ui-pg-$$"
SERVER="kestra-ui-bb-$$"
TEMP_DIR=$(mktemp -d)

cleanup() {
  docker rm -f "$SERVER" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

assert_status() {
  if [ "$2" != "$3" ]; then
    echo "FAIL: $1 expected=$2 actual=$3"
    exit 1
  fi
  echo "PASS: $1"
}

location() {
  sed -n 's/^[Ll]ocation: *//p' "$1" | tr -d '\r'
}

request() {
  curl --fail-with-body -sS -b "$TEMP_DIR/cookies" -c "$TEMP_DIR/cookies" \
    -D "$TEMP_DIR/headers" -o "$TEMP_DIR/body" -w '%{http_code}' "$@"
}

docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_DB=kestra -e POSTGRES_USER=kestra -e POSTGRES_PASSWORD=local-test-only postgres:18 >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$PG" pg_isready -U kestra >/dev/null 2>&1; then break; fi
  sleep 2
done

cat > "$TEMP_DIR/config.yml" <<YAML
datasources:
  postgres:
    url: jdbc:postgresql://$PG:5432/kestra
    driverClassName: org.postgresql.Driver
    username: kestra
    password: local-test-only
kestra:
  repository:
    type: postgres
  queue:
    type: postgres
  storage:
    type: local
    local:
      base-path: /app/storage
  url: $BASE/
  plugins:
    auto-install:
      enabled: false
  oidc:
    enabled: true
    issuer: $BASE
micronaut:
  security:
    enabled: true
    authentication: idtoken
    filter:
      enabled: true
    redirect:
      login-success: /ui/
      login-failure: /oidc/login?error=1
      unauthorized:
        url: /oauth/login/kestra
    intercept-url-map:
      - pattern: /oidc/**
        access: [isAnonymous()]
      - pattern: /.well-known/**
        access: [isAnonymous()]
      - pattern: /oauth/**
        access: [isAnonymous()]
      - pattern: /health
        access: [isAnonymous()]
      - pattern: /api/v1/configs/login
        access: [isAnonymous()]
      - pattern: /**
        access: [isAuthenticated()]
    oauth2:
      clients:
        kestra:
          client-id: kestra-ui
          client-secret: local-ui-secret
          scopes: [openid, profile, email]
          openid:
            issuer: $BASE
            token:
              url: http://localhost:8080/oidc/token
            jwks-uri: http://localhost:8080/oidc/jwks
            end-session:
              enabled: false
YAML

docker run -d --name "$SERVER" --network "$NET" -p "$PORT:8080" \
  -e KESTRA_CONFIGURATION="$(cat "$TEMP_DIR/config.yml")" "$IMAGE" server standalone >/dev/null
READY=0
for attempt in $(seq 1 60); do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)
  if [ "$status" = 200 ]; then READY=1; break; fi
  sleep 5
done
if [ "$READY" != 1 ]; then docker logs "$SERVER"; exit 1; fi

docker exec -i "$PG" psql -U kestra -d kestra -q -v ON_ERROR_STOP=1 <<SQL
INSERT INTO oidc_user (username,name,email,roles) VALUES ('tester','Tester','tester@local.test','["user"]');
INSERT INTO oidc_user_auth_method (user_id,type,credential)
VALUES ('tester','PASSWORD','\$2a\$10\$Y9P9MR2I8ahJ8av5GEvAGusUNsPvSuXcGLXJwVthfYy8x6K89YtN2');
INSERT INTO oidc_client (client_id,client_secret,redirect_uris,grant_types,scopes)
VALUES ('kestra-ui','local-ui-secret','["$BASE/oauth/callback/kestra"]',
  '["authorization_code","refresh_token"]','["openid","profile","email"]');
SQL

assert_status "anonymous API is denied" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/configs")"
assert_status "UI interception" 307 "$(request -H 'Accept: text/html' "$BASE/ui/")"
CLIENT_LOCATION=$(location "$TEMP_DIR/headers")
[[ "$CLIENT_LOCATION" == /oauth/login/kestra* ]] || { echo 'FAIL: UI must start the OIDC client'; exit 1; }
assert_status "OIDC client authorization redirect" 302 "$(request "$BASE$CLIENT_LOCATION")"
AUTHORIZE_LOCATION=$(location "$TEMP_DIR/headers")
[[ "$AUTHORIZE_LOCATION" == "$BASE/oidc/authorize?"* ]] || { echo 'FAIL: unexpected authorization endpoint'; exit 1; }
assert_status "authorize sends anonymous browser to login" 307 "$(request "$AUTHORIZE_LOCATION")"
LOGIN_LOCATION=$(location "$TEMP_DIR/headers")
assert_status "login form" 200 "$(request "$BASE$LOGIN_LOCATION")"
grep -q 'name="username"' "$TEMP_DIR/body"
RETURN_TO=$(node -e 'const url=new URL(process.argv[1]);process.stdout.write(url.searchParams.get("from")||"")' "$BASE$LOGIN_LOCATION")
[[ "$RETURN_TO" == /oidc/authorize\?* ]] || { echo 'FAIL: authorization request lost'; exit 1; }
assert_status "password login uses GET redirect" 303 "$(request --data-urlencode username=tester \
  --data-urlencode 'password=Passw0rd!' --data-urlencode "from=$RETURN_TO" "$BASE/oidc/login")"
assert_status "post-login authorize" 307 "$(request "$BASE$(location "$TEMP_DIR/headers")")"
CALLBACK_LOCATION=$(location "$TEMP_DIR/headers")
[[ "$CALLBACK_LOCATION" == "$BASE/oauth/callback/kestra?"* ]] || { echo 'FAIL: callback missing'; exit 1; }
assert_status "real OIDC callback and token exchange" 303 "$(request "$CALLBACK_LOCATION")"
grep -q 'JWT' "$TEMP_DIR/cookies"
LANDING_LOCATION=$(location "$TEMP_DIR/headers")
[[ "$LANDING_LOCATION" == /* ]] && LANDING_LOCATION="$BASE$LANDING_LOCATION"
assert_status "authenticated UI" 200 "$(request "$LANDING_LOCATION")"
grep -q 'id="app"' "$TEMP_DIR/body"
ASSET=$(node -e 'const fs=require("fs");const html=fs.readFileSync(process.argv[1],"utf8");const match=html.match(/<script[^>]+src="([^"]+)"/);if(!match)process.exit(1);process.stdout.write(new URL(match[1],process.argv[2]).href)' "$TEMP_DIR/body" "$LANDING_LOCATION")
assert_status "UI JavaScript is delivered" 200 "$(request "$ASSET")"
assert_status "browser cookie authenticates API" 200 "$(request "$BASE/api/v1/configs")"
assert_status "Basic Auth endpoint is disabled" 404 "$(curl -s -b "$TEMP_DIR/cookies" -o /dev/null -w '%{http_code}' "$BASE/api/v1/basicAuthValidationErrors")"
TOKEN_COUNT=$(docker exec "$PG" psql -U kestra -d kestra -Atc \
  "SELECT count(*) FROM oidc_token WHERE client_id='kestra-ui' AND subject='tester' AND token_type IN ('access','refresh')")
assert_status "real access and refresh tokens persisted" 2 "$TOKEN_COUNT"
USED_CODE=$(docker exec "$PG" psql -U kestra -d kestra -Atc \
  "SELECT count(*) FROM oidc_authorization_code WHERE client_id='kestra-ui' AND used=true")
assert_status "authorization code consumed" 1 "$USED_CODE"
assert_status "authenticated dashboard refresh" 200 "$(request "$BASE/ui/dashboards")"
assert_status "authenticated navigation" 200 "$(request "$BASE/ui/main/flows")"
CSRF=$(awk '$6=="csrfToken" {print $7}' "$TEMP_DIR/cookies")
for path in login logout basicAuth; do
  LEGACY_STATUS=$(curl -s -b "$TEMP_DIR/cookies" -X POST \
    -H "X-CSRF-TOKEN: $CSRF" \
    -H 'Content-Type: application/json' -d '{"username":"tester","password":"Passw0rd!"}' \
    -o /dev/null -w '%{http_code}' "$BASE/api/v1/$path")
  [[ "$LEGACY_STATUS" == 404 || "$LEGACY_STATUS" == 403 ]] || { echo "FAIL: legacy $path accepted ($LEGACY_STATUS)"; exit 1; }
  echo "PASS: legacy $path rejected ($LEGACY_STATUS)"
done
assert_status "OIDC logout" 307 "$(request "$BASE/oidc/logout")"
assert_status "API denied after logout" 401 "$(curl -s -b "$TEMP_DIR/cookies" -o /dev/null -w '%{http_code}' "$BASE/api/v1/configs")"
assert_status "UI intercepted after logout" 307 "$(request -H 'Accept: text/html' "$BASE/ui/")"
assert_status "Basic Auth cookie cannot authenticate" 401 "$(curl -s -H 'Cookie: BASIC_AUTH=anything; kestraBasicAuthenticated=true' -o /dev/null -w '%{http_code}' "$BASE/api/v1/configs")"
assert_status "invalid OIDC cookie cannot authenticate" 401 "$(curl -s -H 'Cookie: JWT=invalid' -o /dev/null -w '%{http_code}' "$BASE/api/v1/configs")"
if [ "${BB_BROWSER:-0}" = 1 ]; then
  BB_BROWSER_BASE="$BASE" node "$(dirname "$0")/blackbox-ui-browser.cjs"
fi
echo 'UI OIDC BLACKBOX ALL GREEN'
