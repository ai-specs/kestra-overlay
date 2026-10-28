#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?usage: blackbox-ui-oidc.sh <image-ref>}"
PORT="${BB_UI_PORT:-18081}"
BASE="http://localhost:$PORT"
NET="kestra-ui-bb-$$"
RESOURCE_OWNER="${BB_RESOURCE_OWNER:-$NET}"
PG="kestra-ui-pg-$$"
PG_DATA="$PG-data"
SERVER="kestra-ui-bb-$$"
STORAGE="kestra-ui-storage-$$"
SETUP_MODE="${BB_SETUP_MODE:-form}"
TEMP_DIR=$(mktemp -d)
PASSWORD_RBAC_REPORT="$(dirname "$0")/../.work/password-rbac-$SETUP_MODE.json"
mkdir -p "$(dirname "$PASSWORD_RBAC_REPORT")"
printf '{"completed":false,"checks":[],"phase":"image-startup","mode":"%s"}\n' "$SETUP_MODE" > "$PASSWORD_RBAC_REPORT"
PROFILE_REPORT="$(dirname "$0")/../.work/profile-directory-$SETUP_MODE.json"
printf '{"completed":false,"checks":[],"expectedChecks":26,"phase":"image-startup","mode":"%s"}\n' "$SETUP_MODE" > "$PROFILE_REPORT"
FAVICON_REPORT="$(dirname "$0")/../.work/favicon-$SETUP_MODE.json"
printf '{"completed":false,"checks":[],"phase":"image-startup","mode":"%s"}\n' "$SETUP_MODE" > "$FAVICON_REPORT"
IDENTITY_RECHECK_REPORT="$(dirname "$0")/../.work/identity-recheck-$SETUP_MODE.json"
printf '{"completed":false,"checks":[],"phase":"image-startup","mode":"%s"}\n' "$SETUP_MODE" > "$IDENTITY_RECHECK_REPORT"

cleanup() {
  while read -r container; do docker rm -f "$container" >/dev/null 2>&1 || true; done < <(docker ps -aq --filter "label=owner=$RESOURCE_OWNER" --filter "label=run=$NET")
  while read -r network; do docker network rm "$network" >/dev/null 2>&1 || true; done < <(docker network ls -q --filter "label=owner=$RESOURCE_OWNER" --filter "label=run=$NET")
  while read -r volume; do docker volume rm "$volume" >/dev/null 2>&1 || true; done < <(docker volume ls -q --filter "label=owner=$RESOURCE_OWNER" --filter "label=run=$NET")
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

prepare_directory_probe() {
  docker cp "$SERVER:/app/kestra" "$TEMP_DIR/host.jar"
  javac -proc:none -cp "$TEMP_DIR/host.jar" -d "$TEMP_DIR" "$(dirname "$0")/directory-probe/HttpDirectoryCommand.java" "$(dirname "$0")/directory-probe/IdentityRecheckCommand.java"
  jar --create --file "$TEMP_DIR/directory-command.jar" -C "$TEMP_DIR" HttpDirectoryCommand.class \
    -C "$TEMP_DIR" IdentityRecheckCommand.class -C "$TEMP_DIR" 'IdentityRecheckCommand$Provider.class'
  docker cp "$TEMP_DIR/directory-command.jar" "$SERVER:/tmp/directory-command.jar"
}

docker network create --label "owner=$RESOURCE_OWNER" --label "run=$NET" "$NET" >/dev/null
docker volume create --label "owner=$RESOURCE_OWNER" --label "run=$NET" "$STORAGE" >/dev/null
if docker volume inspect "$PG_DATA" >/dev/null 2>&1; then echo 'FAIL: test database volume already exists'; exit 1; fi
docker volume create --label "owner=$RESOURCE_OWNER" --label "run=$NET" "$PG_DATA" >/dev/null
docker run -d --label "owner=$RESOURCE_OWNER" --label "run=$NET" --name "$PG" --network "$NET" \
  -v "$PG_DATA:/var/lib/postgresql" -e POSTGRES_DB=kestra -e POSTGRES_USER=kestra -e POSTGRES_PASSWORD=local-test-only postgres:18 >/dev/null
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
    registration:
      enabled: true
      max-clients: 10
      max-pending-clients: 10
  ui-extension:
    probe:
      enabled: ${BB_UI_EXTENSION_PROBE:-false}
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
      - pattern: /ping
        access: [isAnonymous()]
      - pattern: /ui/assets/**
        access: [isAnonymous()]
      - pattern: /favicon.ico
        access: [isAnonymous()]
      - pattern: /api/v1/configs/login
        access: [isAnonymous()]
      - pattern: /**
        access: [isAuthenticated()]
    oauth2:
      clients:
        kestra:
          client-id: kestra-ui
          client-secret: \${KESTRA_OIDC_UI_CLIENT_SECRET}
          scopes: [openid, profile, email]
          openid:
            issuer: $BASE
            token:
              url: http://localhost:8080/oidc/token
            jwks-uri: http://localhost:8080/oidc/jwks
            end-session:
              enabled: false
YAML

BOOTSTRAP_ENV=(-e KESTRA_OIDC_BOOTSTRAP_USERNAME= -e KESTRA_OIDC_UI_CLIENT_SECRET=local-ui-secret)
if [ "$SETUP_MODE" = env ]; then
  BOOTSTRAP_ENV=(-e KESTRA_OIDC_UI_CLIENT_SECRET=local-ui-secret -e KESTRA_OIDC_BOOTSTRAP_USERNAME=tester -e 'KESTRA_OIDC_BOOTSTRAP_PASSWORD=Passw0rd!' \
    -e KESTRA_OIDC_BOOTSTRAP_EMAIL=tester@local.test -e KESTRA_OIDC_BOOTSTRAP_NAME=Tester -e KESTRA_OIDC_SETUP_ALLOWED=false)
elif [ "$SETUP_MODE" != form ]; then
  echo 'FAIL: BB_SETUP_MODE must be form or env'; exit 1
fi
EXTENSION_MOUNT=()
if [ -n "${BB_UI_EXTENSION_JAR:-}" ]; then
  EXTENSION_MOUNT=(-v "$BB_UI_EXTENSION_JAR:/app/libs/kestra-rbac-authorizer.jar:ro")
fi
docker run -d --label "owner=$RESOURCE_OWNER" --label "run=$NET" --name "$SERVER" --network "$NET" -p "$PORT:8080" ${EXTENSION_MOUNT[@]+"${EXTENSION_MOUNT[@]}"} \
  -v "$STORAGE:/app/storage" \
  "${BOOTSTRAP_ENV[@]}" -e KESTRA_CONFIGURATION="$(cat "$TEMP_DIR/config.yml")" "$IMAGE" server standalone >/dev/null
READY=0
for attempt in $(seq 1 60); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$SERVER")" != true ]; then
    docker logs "$SERVER"; exit 1
  fi
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)
  if [ "$status" = 200 ]; then READY=1; break; fi
  sleep 5
done
if [ "$READY" != 1 ]; then docker logs "$SERVER"; exit 1; fi

if [ "$SETUP_MODE" = form ]; then
  if [ "${BB_BROWSER:-0}" = 1 ]; then
    prepare_directory_probe
    BB_BROWSER_SETUP=1 BB_BROWSER_BASE="$BASE" BB_BROWSER_SERVER="$SERVER" BB_BROWSER_POSTGRES="$PG" node "$(dirname "$0")/blackbox-ui-browser.cjs"
  else
    assert_status "empty directory offers setup" 200 "$(request "$BASE/oidc/setup")"
    SETUP_CSRF=$(node -e 'const fs=require("fs");const html=fs.readFileSync(process.argv[1],"utf8");const match=html.match(/name="csrf" value="([^"]+)"/);if(!match)process.exit(1);process.stdout.write(match[1])' "$TEMP_DIR/body")
    assert_status "setup rejects cross-origin POST" 403 "$(curl -s -b "$TEMP_DIR/cookies" -H 'Origin: https://attacker.example' \
      --data-urlencode "csrf=$SETUP_CSRF" -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
    assert_status "setup creates OIDC user and UI client" 303 "$(request -H "Origin: $BASE" \
      --data-urlencode "csrf=$SETUP_CSRF" --data-urlencode username=tester --data-urlencode name=Tester \
      --data-urlencode email=tester@local.test --data-urlencode 'password=Passw0rd!' "$BASE/oidc/setup")"
  fi
else
  assert_status "environment bootstrap skips setup" 302 "$(request "$BASE/oauth/login/kestra")"
fi
assert_status "setup closed after initialization" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
assert_status "anonymous ping" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/ping")"
assert_status "completed setup rejects bodyless POST before binding" 404 "$(curl -s -X POST -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
assert_status "completed setup rejects malformed POST before binding" 404 "$(curl -s -X POST -H 'Content-Type: application/json' -d '{' -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
assert_status "completed setup POST cannot reactivate" 404 "$(curl -s -X POST -H "Origin: $BASE" \
  -d 'username=attacker&password=AttackerPass123!' -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
python3 "$(dirname "$0")/directory-probe/http-check.py" "$BASE" "$SERVER" "$PG" \
  "$(dirname "$0")/../.work/directory-http-$SETUP_MODE.json"
python3 "$(dirname "$0")/directory-probe/profile-check.py" "$BASE" "$SERVER" "$PG" "$PROFILE_REPORT"
HASH_BEFORE=$(docker exec "$PG" psql -U kestra -d kestra -Atc "SELECT credential FROM oidc_user_auth_method WHERE user_id='tester' AND type='PASSWORD'")
[[ "$HASH_BEFORE" == '$2a$'* ]] || { echo 'FAIL: password must be bcrypt'; exit 1; }

assert_status "anonymous API is denied" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/configs")"
assert_status "UI interception" 307 "$(request -H 'Accept: text/html' "$BASE/ui/")"
assert_status "anonymous login translation asset" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/ui/assets/oidc-login-i18n.js")"
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
SECRETLESS_STATUS=$(curl -s -d 'client_id=kestra-ui&grant_type=client_credentials' -o /dev/null -w '%{http_code}' "$BASE/oidc/token")
[[ "$SECRETLESS_STATUS" == 400 || "$SECRETLESS_STATUS" == 401 ]] || { echo 'FAIL: confidential client omitted secret'; exit 1; }
echo 'PASS: confidential client cannot omit secret'
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
[[ "$TOKEN_COUNT" -ge 2 ]] || { echo 'FAIL: real tokens not persisted'; exit 1; }
echo 'PASS: real access and refresh tokens persisted'
USED_CODE=$(docker exec "$PG" psql -U kestra -d kestra -Atc \
  "SELECT count(*) FROM oidc_authorization_code WHERE client_id='kestra-ui' AND used=true")
[[ "$USED_CODE" -ge 1 ]] || { echo 'FAIL: authorization code not consumed'; exit 1; }
echo 'PASS: authorization code consumed'
assert_status "discovery publishes dynamic registration" 200 "$(request "$BASE/.well-known/openid-configuration")"
grep -q 'registration_endpoint' "$TEMP_DIR/body"
assert_status "register public client without secret" 201 "$(request -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["http://127.0.0.1:9999/cb"],"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"]}' "$BASE/oidc/register")"
PUBLIC_ID=$(node -e 'const data=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(data.client_secret!==undefined)process.exit(1);process.stdout.write(data.client_id)' "$TEMP_DIR/body")
VERIFIER='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
CHALLENGE=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.argv[1]).digest("base64url"))' "$VERIFIER")
assert_status "explicit empty challenge rejected" 400 "$(curl -s -G --data-urlencode "client_id=$PUBLIC_ID" \
  --data-urlencode 'redirect_uri=http://127.0.0.1:9999/cb' --data-urlencode response_type=code \
  --data-urlencode code_challenge= -o /dev/null -w '%{http_code}' "$BASE/oidc/authorize")"
assert_status "public S256 consent page" 200 "$(request -G --data-urlencode "client_id=$PUBLIC_ID" \
  --data-urlencode 'redirect_uri=http://127.0.0.1:9999/cb' --data-urlencode response_type=code \
  --data-urlencode scope=openid --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode code_challenge_method=S256 "$BASE/oidc/authorize")"
INTERACTION=$(node -e 'const text=require("fs").readFileSync(process.argv[1],"utf8");const match=text.match(/name="interaction" value="([^"]+)"/);if(!match)process.exit(1);process.stdout.write(match[1])' "$TEMP_DIR/body")
assert_status "public client user confirms ownership" 303 "$(request -H "Origin: $BASE" \
  --data-urlencode "interaction=$INTERACTION" --data-urlencode decision=approve \
  --data-urlencode scope-openid=yes "$BASE/oidc/consent")"
PUBLIC_CODE=$(node -e 'process.stdout.write(new URL(process.argv[1]).searchParams.get("code")||"")' "$(location "$TEMP_DIR/headers")")
assert_status "public client requires verifier" 400 "$(curl -s -d "client_id=$PUBLIC_ID&grant_type=authorization_code&code=$PUBLIC_CODE&redirect_uri=http://127.0.0.1:9999/cb" \
  -o /dev/null -w '%{http_code}' "$BASE/oidc/token")"
assert_status "public client exchanges code without secret" 200 "$(request \
  --data-urlencode "client_id=$PUBLIC_ID" --data-urlencode grant_type=authorization_code \
  --data-urlencode "code=$PUBLIC_CODE" --data-urlencode 'redirect_uri=http://127.0.0.1:9999/cb' \
  --data-urlencode "code_verifier=$VERIFIER" "$BASE/oidc/token")"
PUBLIC_TOKEN=$(node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!data.id_token||!data.refresh_token)process.exit(1);process.stdout.write(data.access_token)' "$TEMP_DIR/body")
assert_status "registered public client userinfo" 200 "$(request -H "Authorization: Bearer $PUBLIC_TOKEN" "$BASE/oidc/userinfo")"
assert_status "registration rejects remote HTTP callback" 400 "$(curl -s -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["http://attacker.example/cb"],"token_endpoint_auth_method":"none"}' -o /dev/null -w '%{http_code}' "$BASE/oidc/register")"
assert_status "authenticated dashboard refresh" 200 "$(request "$BASE/ui/dashboards")"
assert_status "authenticated navigation" 200 "$(request "$BASE/ui/main/flows")"
if [ -n "${BB_UI_EXTENSION_EGO_SPACE:-}" ]; then
  python3 - "$(dirname "$0")/ui-extension-ego.mjs" "$(dirname "$0")/ui-extension-cases.mjs" "$BASE" \
    "$(dirname "$0")/../.work/ui-extension-ego.json" "$BB_UI_EXTENSION_EGO_SPACE" <<'PYEGO' | ego-browser nodejs
import json,pathlib,sys
entry,cases,base,report,space=sys.argv[1:]
print('const UI_EXTENSION_SPACE='+json.dumps(int(space))+';')
print('const UI_EXTENSION_BASE='+json.dumps(base)+';')
print('const UI_EXTENSION_REPORT='+json.dumps(str(pathlib.Path(report).resolve()))+';')
print('const UI_EXTENSION_CASES='+json.dumps(pathlib.Path(cases).resolve().as_uri())+';')
scripts=pathlib.Path(entry).resolve().parent
print('const UI_THEME_CASES='+json.dumps((scripts/'auth-theme-cases.mjs').as_uri())+';')
print('const UI_I18N_CASES='+json.dumps((scripts/'auth-i18n-cases.mjs').as_uri())+';')
print('const UI_THEME_REPORT='+json.dumps(str(pathlib.Path(report).resolve().with_name('auth-theme-local-management.json')))+';')
print('const UI_I18N_REPORT='+json.dumps(str(pathlib.Path(report).resolve().with_name('auth-i18n-local-management.json')))+';')
print(pathlib.Path(entry).read_text())
PYEGO
fi
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
  prepare_directory_probe
  BB_BROWSER_BASE="$BASE" BB_BROWSER_SERVER="$SERVER" BB_BROWSER_POSTGRES="$PG" node "$(dirname "$0")/blackbox-ui-browser.cjs"
fi
docker restart "$SERVER" >/dev/null
for attempt in $(seq 1 60); do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)
  [ "$status" = 200 ] && break
  sleep 5
done
assert_status "restart keeps setup closed" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
HASH_AFTER=$(docker exec "$PG" psql -U kestra -d kestra -Atc "SELECT credential FROM oidc_user_auth_method WHERE user_id='tester' AND type='PASSWORD'")
assert_status "restart does not overwrite password" "$HASH_BEFORE" "$HASH_AFTER"
docker rm -f "$SERVER" >/dev/null
docker run -d --label "owner=$RESOURCE_OWNER" --label "run=$NET" --name "$SERVER" --network "$NET" -p "$PORT:8080" ${EXTENSION_MOUNT[@]+"${EXTENSION_MOUNT[@]}"} -v "$STORAGE:/app/storage" \
  "${BOOTSTRAP_ENV[@]}" -e KESTRA_OIDC_BOOTSTRAP_USERNAME=attacker -e 'KESTRA_OIDC_BOOTSTRAP_PASSWORD=InjectedPass123!' \
  -e KESTRA_CONFIGURATION="$(cat "$TEMP_DIR/config.yml")
kestra.rbac.application-groups.enabled: true
kestra.rbac.enabled: true
kestra.rbac.typed.enabled: true
kestra.rbac.evaluation.enabled: true" "$IMAGE" server standalone >/dev/null
for attempt in $(seq 1 60); do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)
  [ "$status" = 200 ] && break
  sleep 5
done
assert_status "recreated container ignores injected bootstrap account" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
ATTACKER_COUNT=$(docker exec "$PG" psql -U kestra -d kestra -Atc "SELECT count(*) FROM oidc_user WHERE username='attacker'")
assert_status "bootstrap cannot add another initial account" 0 "$ATTACKER_COUNT"
node "$(dirname "$0")/protocol-session-probe.mjs" "$BASE"
prepare_directory_probe
docker exec "$SERVER" java -cp /app/kestra:/tmp/directory-command.jar IdentityRecheckCommand \
  "jdbc:postgresql://$PG:5432/kestra" "$BASE" > "$IDENTITY_RECHECK_REPORT"
python3 - "$IDENTITY_RECHECK_REPORT" <<'PYIDENTITY'
import json,sys
report=json.load(open(sys.argv[1]))
assert report['completed'] and len(report['checks'])==24 and all(row['passed'] for row in report['checks'])
print('IDENTITY LOCK RECHECK IMAGE GREEN: 24 checks')
PYIDENTITY
python3 "$(dirname "$0")/directory-probe/password-rbac-check.py" "$BASE" "$SERVER" "$PG" \
  "$PASSWORD_RBAC_REPORT"
if [ "${BB_BROWSER:-0}" = 1 ]; then
  FAVICON_SHA256=$(python3 - "$TEMP_DIR/host.jar" <<'PYFAVICON'
import hashlib,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    print(hashlib.sha256(archive.read('root/favicon.ico')).hexdigest())
PYFAVICON
  )
  BB_BROWSER_BASE="$BASE" BB_BROWSER_SERVER="$SERVER" BB_BROWSER_POSTGRES="$PG" \
    BB_FAVICON_EXPECTED_SHA256="$FAVICON_SHA256" BB_FAVICON_REPORT="$FAVICON_REPORT" \
    node "$(dirname "$0")/favicon-browser.cjs"
fi
UNBOUND_CODES=$(docker exec "$PG" psql -U kestra -d kestra -Atc "SELECT count(*) FROM oidc_authorization_code WHERE client_id<>'kestra-ui' AND created_at>now()-interval '1 minute' AND NOT used")
assert_status "missing projection creates no ordinary authorization code" 0 "$UNBOUND_CODES"
INSTALLATION_ID=$(docker exec "$PG" psql -U kestra -d kestra -Atc 'SELECT installation_id FROM oidc_setup')
docker exec "$PG" psql -U kestra -d kestra -q -v ON_ERROR_STOP=1 -c 'DELETE FROM oidc_setup'
assert_status "deleted database marker fails closed" 500 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
assert_status "deleted marker cannot reactivate setup POST" 500 "$(curl -s -X POST -H "Origin: $BASE" \
  -d 'username=attacker&password=AttackerPass123!' -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
docker exec -i "$PG" psql -U kestra -d kestra -q -v ON_ERROR_STOP=1 -v installation_id="$INSTALLATION_ID" <<'SQL'
INSERT INTO oidc_setup (singleton,installation_id) VALUES (true,:'installation_id');
SQL
docker exec "$SERVER" rm /app/storage/.oidc-installation
assert_status "deleted file receipt cannot reopen setup" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
RECEIPT_ID=$(docker exec "$SERVER" sh -c 'sed -n 2p /app/storage/.oidc-installation')
assert_status "receipt restores original installation identity" "$INSTALLATION_ID" "$RECEIPT_ID"
docker exec "$SERVER" sh -c 'printf "kestra-oidc-installation-v1\n00000000-0000-0000-0000-000000000000\n" > /app/storage/.oidc-installation'
assert_status "replaced receipt fails closed" 500 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
echo 'UI OIDC BLACKBOX ALL GREEN'
