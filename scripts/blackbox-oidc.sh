#!/usr/bin/env bash
# blackbox-oidc.sh — 镜像级 OIDC 流程黑盒门（AGENTS §4 镜像级黑盒，R-OIDC-SERVER DoD）
# 用法：./scripts/blackbox-oidc.sh <image-ref>   （本机/CI 皆可；需 Docker + 已登录 GHCR）
#
# 两阶段：
#   Phase A（默认关回归）：不开 kestra.oidc.enabled —— /oidc/* 与 /.well-known/* 全 404
#     （功能门控 F2 vanilla 等价）、/ui/ 返回上游 UI HTML、
#     /api/v1/* 未带凭据 401（OSS 默认强制 basic auth）。
#   Phase B（开启后全链）：kestra.oidc.enabled=true —— discovery 元数据（S256-only）、
#     JWKS、登录页渲染、坏凭据 401、好凭据 303+会话 cookie、authorize 发码（state 回显）、
#     code 换 token 三件套、code 重放拒绝（D1）、userinfo sub 校验、alg=none 拒绝（B2）、
#     refresh 轮换（旧 refresh 用后即废）。
set -euo pipefail

IMAGE="${1:?usage: blackbox-oidc.sh <image-ref>}"
NET="kestra-bb-$$"
PG="kestra-bb-pg-$$"
K1="kestra-bb-a-$$"
K2="kestra-bb-b-$$"
PORT="${BB_PORT:-18080}"
BASE="http://localhost:${PORT}"
T=$(mktemp -d)
USER="admin@local.test"
PASS="Admin1234!"
OIDC_USER="tester"
OIDC_PASS="Passw0rd!"
PASS_CNT=0; FAIL_CNT=0

ok()  { PASS_CNT=$((PASS_CNT+1)); echo "  PASS  $1"; }
bad() { FAIL_CNT=$((FAIL_CNT+1)); echo "  FAIL  $1 (got: ${2:-?})"; }
assert_eq() { # desc expected actual
  [ "$2" = "$3" ] && ok "$1" || bad "$1" "expected=$2 actual=$3"
}
assert_contains() { # desc needle haystack-file
  grep -q "$2" "$3" && ok "$1" || bad "$1" "「$2」not found"
}

cleanup() {
  rm -rf "$T"
  docker rm -f "$K1" "$K2" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

conf() { # [oidc-enabled]
  cat <<YAML
datasources:
  postgres:
    url: jdbc:postgresql://$PG:5432/kestra
    driverClassName: org.postgresql.Driver
    username: kestra
    password: k3str4
kestra:
  server:
    basic-auth:
      enabled: true
      username: $USER
      password: $PASS
  repository:
    type: postgres
  storage:
    type: local
    local:
      base-path: /app/storage
  queue:
    type: postgres
  url: $BASE/
  plugins:
    auto-install:
      enabled: false
YAML
  if [ "${1:-}" = "oidc" ]; then
    cat <<YAML
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
      unauthorized:
        url: /oauth/login/kestra
    intercept-url-map:
      - pattern: /oidc/**
        access: [isAnonymous()]
      - pattern: /.well-known/**
        access: [isAnonymous()]
      - pattern: /oauth/**
        access: [isAnonymous()]
      - pattern: /api/v1/configs/login
        access: [isAnonymous()]
      - pattern: /**
        access: [isAuthenticated()]
    oauth2:
      clients:
        kestra:
          client-id: rp-test
          client-secret: rp-secret
          scopes: [openid, profile, email]
          openid:
            issuer: $BASE
            token:
              url: http://localhost:8080/oidc/token
            jwks-uri: http://localhost:8080/oidc/jwks
            end-session:
              enabled: false
YAML
  fi
}

wait_ready() { # container-name
  for i in $(seq 1 60); do
    if [ "$1" = "$K2" ]; then
      code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration" || true)
    else
      code=$(curl -s -u "$USER:$PASS" -o /dev/null -w '%{http_code}' "$BASE/api/v1/configs" || true)
    fi
    [ "$code" = "200" ] && return 0
    sleep 5
  done
  echo "FAIL: $1 未就绪（300s）"; docker logs "$1" 2>&1 | tail -20; exit 1
}

echo "== Phase A: 默认关（vanilla 等价 + UI 保留）=="
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_DB=kestra -e POSTGRES_USER=kestra -e POSTGRES_PASSWORD=k3str4 postgres:18 >/dev/null
for i in $(seq 1 30); do docker exec "$PG" pg_isready -U kestra >/dev/null 2>&1 && break; sleep 2; done

docker run -d --name "$K1" --network "$NET" -p "$PORT:8080" \
  -e KESTRA_CONFIGURATION="$(conf)" "$IMAGE" server standalone >/dev/null
wait_ready "$K1"

assert_eq "未认证 API → 401（OSS 默认强制 basic auth）" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/configs")"
assert_eq "discovery 默认关 → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/.well-known/openid-configuration")"
assert_eq "jwks 默认关 → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/jwks")"
assert_eq "login 默认关 → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/login")"
assert_eq "已认证 /ui/ → 200（保留上游 UI）" 200 "$(curl -s -u "$USER:$PASS" -o "$T/ui.html" -w '%{http_code}' "$BASE/ui/")"
assert_contains "UI HTML 包含应用挂载点" 'id="app"' "$T/ui.html"

docker rm -f "$K1" >/dev/null

echo "== Phase B: kestra.oidc.enabled=true 全链 =="
docker run -d --name "$K2" --network "$NET" -p "$PORT:8080" \
  -e KESTRA_OIDC_BOOTSTRAP_USERNAME="$OIDC_USER" -e KESTRA_OIDC_BOOTSTRAP_PASSWORD="$OIDC_PASS" \
  -e KESTRA_OIDC_BOOTSTRAP_EMAIL=tester@local.test -e KESTRA_OIDC_BOOTSTRAP_NAME=Tester \
  -e KESTRA_OIDC_SETUP_ALLOWED=false \
  -e KESTRA_CONFIGURATION="$(conf oidc)" "$IMAGE" server standalone >/dev/null
wait_ready "$K2"

assert_eq "环境变量完成生产初始化" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/login")"
assert_eq "环境初始化后 setup 关闭" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/oidc/setup")"
assert_eq "动态注册默认关闭" 404 "$(curl -s -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' "$BASE/oidc/register")"

# discovery 元数据
code=$(curl -s -o "$T/disc.json" -w '%{http_code}' "$BASE/.well-known/openid-configuration")
assert_eq "discovery 200" 200 "$code"
assert_contains "discovery 含 issuer" '"issuer"' "$T/disc.json"
assert_contains "discovery S256-only（加固）" '"S256"' "$T/disc.json"
if grep -q '"PLAIN"' "$T/disc.json"; then bad "discovery 不得广播 PLAIN"; else ok "discovery 无 PLAIN"; fi

# jwks（首用生成）
assert_eq "jwks 200" 200 "$(curl -s -o "$T/jwks.json" -w '%{http_code}' "$BASE/oidc/jwks")"

# 登录页
code=$(curl -s -o "$T/login.html" -w '%{http_code}' "$BASE/oidc/login?from=/ui/")
assert_eq "登录页 200" 200 "$code"
assert_contains "登录页渲染表单" 'name="username"' "$T/login.html"

# 坏凭据 → 401
assert_eq "坏凭据 → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' \
  -d "username=$OIDC_USER&password=WRONG&from=/ui/" "$BASE/oidc/login")"

# 好凭据 → 302 + 会话 cookie
code=$(curl -s -c "$T/jar" -o /dev/null -w '%{http_code}' -d "username=$OIDC_USER&password=$OIDC_PASS&from=/ui/" "$BASE/oidc/login")
assert_eq "good credentials redirect with GET (303)" 303 "$code"
grep -q "oidc_session" "$T/jar" && ok "登录种下 oidc_session cookie" || bad "oidc_session cookie 缺失"

# authorize：带会话 → 302 code+state
AUTH="$BASE/oidc/authorize?client_id=rp-test&redirect_uri=$BASE/oauth/callback/kestra&response_type=code&scope=openid&state=xyz123"
loc=$(curl -s -b "$T/jar" -o /dev/null -w '%{redirect_url}' "$AUTH")
echo "$loc" | grep -q "code=" && ok "authorize 发码（302 带 code）" || bad "authorize 未发码" "$loc"
echo "$loc" | grep -q "state=xyz123" && ok "state 回显" || bad "state 丢失" "$loc"
CODE=$(echo "$loc" | sed -n 's/.*code=\([^&]*\).*/\1/p')
[ -n "$CODE" ] || bad "code 未提取（登录/authorize 级联失败）"

# 未登录 authorize → 302 登录页（from 深链）
loc2=$(curl -s -o /dev/null -w '%{redirect_url}' "$AUTH")
if echo "$loc2" | grep -q "/oidc/login?"; then ok "anonymous authorize redirected to login"; else bad "anonymous authorize NOT redirected" "$loc2"; fi

# code 换 token 三件套
code=$(curl -s -u rp-test:rp-secret -o "$T/token.json" -w '%{http_code}' \
  -d "grant_type=authorization_code&code=$CODE&redirect_uri=$BASE/oauth/callback/kestra" "$BASE/oidc/token")
assert_eq "token 端点 200" 200 "$code"
for f in access_token id_token refresh_token; do
  assert_contains "token 响应含 $f" "$f" "$T/token.json"
done

# code replay must be rejected (D1)
REPLAY_D="grant_type=authorization_code&code=$CODE&redirect_uri=$BASE/oauth/callback/kestra"
code=$(curl -s -u rp-test:rp-secret -o "$T/replay.json" -w '%{http_code}' -d "$REPLAY_D" "$BASE/oidc/token")
if [ "$code" = "400" ] || [ "$code" = "401" ]; then ok "code replay rejected ($code)"; else bad "code replay NOT rejected" "$code"; fi

# userinfo
AT=$(sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p' "$T/token.json")
assert_eq "userinfo 200" 200 "$(curl -s -H "Authorization: Bearer $AT" -o "$T/ui.json" -w '%{http_code}' "$BASE/oidc/userinfo")"
assert_contains "userinfo sub=tester" '"sub":"tester"' "$T/ui.json" || assert_contains "userinfo sub" '"sub"' "$T/ui.json"

# alg=none 攻击载荷 → 401（B2）
H=$(printf '{"alg":"none"}' | base64 | tr '+/' '-_' | tr -d '=')
P=$(printf '{"sub":"forged"}' | base64 | tr '+/' '-_' | tr -d '=')
assert_eq "alg=none token → 401" 401 "$(curl -s -H "Authorization: Bearer $H.$P." -o /dev/null -w '%{http_code}' "$BASE/oidc/userinfo")"

# refresh 轮换：旧 refresh 用后即废
RT=$(sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p' "$T/token.json")
RT_D="grant_type=refresh_token&refresh_token=$RT"
code=$(curl -s -u rp-test:rp-secret -o "$T/rt.json" -w '%{http_code}' -d "$RT_D" "$BASE/oidc/token")
assert_eq "refresh rotation 200" 200 "$code"
assert_contains "rotated response has access_token" "access_token" "$T/rt.json"
code=$(curl -s -u rp-test:rp-secret -o /dev/null -w '%{http_code}' -d "$RT_D" "$BASE/oidc/token")
if [ "$code" = "400" ] || [ "$code" = "401" ]; then ok "old refresh reuse rejected ($code, rotation)"; else bad "old refresh NOT rejected" "$code"; fi

echo
echo "结果: PASS=$PASS_CNT FAIL=$FAIL_CNT"
rm -rf "$T"
[ "$FAIL_CNT" = "0" ] && echo "BLACKBOX ALL GREEN" || exit 1
