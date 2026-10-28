#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:?image}"
PROBE="${2:?own independently compiled probe jar}"
REPORT="${3:?report path}"
EXPECTED="${4:-503}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="${BB_RESOURCE_OWNER:-host-dependency503-$$}"
RUN="dependency503-$$"
PG="$RUN-pg"
APP="$RUN-app"
VOLUME="$RUN-pg-data"
STORAGE="$RUN-storage"
PORT="${BB_DEPENDENCY_PORT:-18489}"
BASE="http://localhost:$PORT"
# Inventory commands must succeed; a failed inspection never grants cleanup ownership.
networks="$(docker network ls --format '{{.Name}}')"
containers="$(docker ps -a --format '{{.Names}}')"
volumes="$(docker volume ls --format '{{.Name}}')"
assert_absent() {
 local expected="$1" inventory="$2" item
 while IFS= read -r item; do
  if [ "$item" = "$expected" ]; then
   printf 'Resource already exists: %s\n' "$expected" >&2
   return 1
  fi
 done <<< "$inventory"
}
assert_absent "$RUN" "$networks"
assert_absent "$PG" "$containers"
assert_absent "$APP" "$containers"
assert_absent "$VOLUME" "$volumes"
assert_absent "$STORAGE" "$volumes"
created_networks=()
created_containers=()
created_volumes=()
owned() {
 local kind="$1" name="$2" labels
 labels="$(docker "$kind" inspect --format '{{index .Labels "owner"}}/{{index .Labels "run"}}' "$name" 2>/dev/null)" || return 1
 [ "$labels" = "$OWNER/$RUN" ]
}
owned_container() {
 local labels
 labels="$(docker inspect --format '{{index .Config.Labels "owner"}}/{{index .Config.Labels "run"}}' "$1" 2>/dev/null)" || return 1
 [ "$labels" = "$OWNER/$RUN" ]
}
cleanup() {
 result=$?
 trap - EXIT
 set +e
 for item in "${created_containers[@]}"; do
  if owned_container "$item"; then docker rm -f "$item" >/dev/null || result=1; else result=1; fi
 done
 for item in "${created_networks[@]}"; do
  if owned network "$item"; then docker network rm "$item" >/dev/null || result=1; else result=1; fi
 done
 for item in "${created_volumes[@]}"; do
  if owned volume "$item"; then docker volume rm "$item" >/dev/null || result=1; else result=1; fi
 done
 exit "$result"
}
# Only resources successfully created below can enter the cleanup lists.
trap cleanup EXIT
mkdir -p "$(dirname "$REPORT")"
printf '{"completed":false,"checks":[],"phase":"startup"}\n' > "$REPORT"
docker network create --label "owner=$OWNER" --label "run=$RUN" "$RUN" >/dev/null
created_networks+=("$RUN")
owned network "$RUN"
docker volume create --label "owner=$OWNER" --label "run=$RUN" "$VOLUME" >/dev/null
created_volumes+=("$VOLUME")
owned volume "$VOLUME"
docker volume create --label "owner=$OWNER" --label "run=$RUN" "$STORAGE" >/dev/null
created_volumes+=("$STORAGE")
owned volume "$STORAGE"
docker run -d --name "$PG" --label "owner=$OWNER" --label "run=$RUN" --network "$RUN" \
 --mount "type=volume,source=$VOLUME,target=/var/lib/postgresql" -e POSTGRES_DB=kestra -e POSTGRES_USER=kestra -e POSTGRES_PASSWORD=local-test-only postgres:18 >/dev/null
created_containers+=("$PG")
owned_container "$PG"
for attempt in $(seq 1 60); do if docker exec "$PG" pg_isready -U kestra >/dev/null 2>&1; then break; fi; sleep 1; done
docker exec "$PG" psql -U kestra -d kestra -v ON_ERROR_STOP=1 -c 'CREATE TABLE host_dependency503_probe(singleton BOOLEAN PRIMARY KEY, available BOOLEAN NOT NULL); INSERT INTO host_dependency503_probe VALUES(true,true);' >/dev/null
CONFIG="$(cat <<YAML
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
  dependency503:
    probe:
      enabled: true
  rbac:
    enabled: true
    typed:
      enabled: true
    evaluation:
      enabled: true
    application-groups:
      enabled: true
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
          client-secret: local-ui-secret
          scopes: [openid,profile,email,'kestra:application-group-scopes']
          openid:
            issuer: $BASE
            token:
              url: http://localhost:8080/oidc/token
            jwks-uri: http://localhost:8080/oidc/jwks
YAML
)"
docker run -d --name "$APP" --label "owner=$OWNER" --label "run=$RUN" --network "$RUN" -p "$PORT:8080" \
 --mount "type=volume,source=$STORAGE,target=/app/storage" -v "$PROBE:/app/libs/kestra-rbac-authorizer.jar:ro" \
 -e KESTRA_CONFIGURATION="$CONFIG" -e KESTRA_OIDC_UI_CLIENT_SECRET=local-ui-secret \
 -e KESTRA_OIDC_BOOTSTRAP_USERNAME=tester -e KESTRA_OIDC_BOOTSTRAP_PASSWORD=Passw0rd! \
 -e KESTRA_OIDC_BOOTSTRAP_NAME=Tester -e KESTRA_OIDC_BOOTSTRAP_EMAIL=tester@example.invalid "$IMAGE" server standalone >/dev/null
created_containers+=("$APP")
owned_container "$APP"
ready=0
for attempt in $(seq 1 90); do
 if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)" = 200 ]; then ready=1;break;fi
 sleep 2
done
test "$ready" = 1
node "$REPO/scripts/dependency503-image-check.mjs" "$BASE" "$PG" "$REPORT" "$EXPECTED"
