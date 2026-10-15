#!/usr/bin/env bash
# local-ci.sh — 本地 CI 等效循环（R-OIDC-SERVER 类实施的动刀期工具，2026-10-07 裁定）
#
# 两棵树的约定（.work/ 不入库，.gitignore 已列）：
#   .work/dev    开发树：§5.3 增量提交法在此进行（edit → commit → diff 出 patch）。
#                本脚本【绝不触碰】这棵树。
#   .work/verify 验证树：本脚本的默认工作区。每次运行 hard reset 到 BASE 后按序
#                重放全部 patch——模拟真 CI 的 patch-verify，可反复运行。
#
# 用法：
#   ./scripts/local-ci.sh                     # 全链：refresh+apply → 定向测试 → executableJar
#   ./scripts/local-ci.sh --apply-only        # 只到 apply（快，结构验证）
#   ./scripts/local-ci.sh --tests 'A.*,B.C'   # 覆盖定向测试过滤（默认取 patch 引入的包）
#   KESTRA_UPSTREAM_REPO=/path/to/clone ./scripts/local-ci.sh   # 本地源加速/离线
#
# 纪律：apply 逐 patch「check→apply」交替（AGENTS §8-8）；测试只跑 patch 引入的包
# （§4 测试同批——不跑上游全量）；本地全绿后才能组织 patch 提交推送（真 CI 唯一通过标志不变）。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE="$(sed -n 1p "$REPO/patches/BASE")"
BASE="$(sed -n 2p "$REPO/patches/BASE")"
UPSTREAM_REPO="${KESTRA_UPSTREAM_REPO:-https://github.com/kestra-io/kestra.git}"
WORK="${WORK:-$REPO/.work/verify}"
TESTS="${TESTS_OVERRIDE:-io.kestra.webserver.oidc.*}"

if [ "${1:-}" = "--tests" ]; then TESTS="${2:?--tests 需要过滤表达式}"; shift 2; fi
APPLY_ONLY=0; [ "${1:-}" = "--apply-only" ] && APPLY_ONLY=1

echo "== local-ci: upstream=$UPSTREAM_REPO base=${BASE:0:12} verify=$WORK =="
if [ ! -d "$WORK/.git" ]; then
  git clone --depth 1 --branch "$RELEASE" "$UPSTREAM_REPO" "$WORK"
fi
# 验证树是一次性草稿：丢弃任何残留状态后固定在 BASE（绝不用于开发）
git -C "$WORK" checkout -q --detach "$BASE" 2>/dev/null || true
git -C "$WORK" reset -q --hard "$BASE"
git -C "$WORK" clean -qfd

echo "== apply patches (check→apply per patch) =="
N=0
for p in "$REPO"/patches/*/*.patch; do
  git -C "$WORK" apply --check "$p" || { echo "FAIL: $p"; exit 1; }
  git -C "$WORK" apply "$p"
  N=$((N+1))
done
echo "OK: BASE + $N patches applied"

if [ "$APPLY_ONLY" = "1" ]; then
  echo "OK: apply-only done (no compile)"
  exit 0
fi

python3 -m unittest discover -s "$REPO/scripts/tests" -v

echo "== scoped tests (filter: $TESTS) =="
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 25 2>/dev/null || true)"
fi
(cd "$WORK" && ./gradlew :webserver:test --tests "$TESTS" \
  --tests 'io.kestra.webserver.rbac.*' --tests io.kestra.mcp.McpExecutionGateTest --tests io.kestra.mcp.McpSessionIdentityTest \
  --tests io.kestra.mcp.McpServerHandlerTransportTest --tests io.kestra.mcp.McpEvaluationLifecycleTest \
  --tests 'io.kestra.webserver.ui.*' --console=plain)
python3 "$REPO/scripts/check-typed-authorization-tests.py" "$WORK/webserver/build/test-results/test"

echo "== executable jar =="
(cd "$WORK/ui" && npm ci && npm run build)
(cd "$WORK/ui" && npm run test:unit -- src/utils/authentication.spec.ts src/extensions/runtime.spec.ts)
test -s "$WORK/webserver/src/main/resources/ui/index.html"
(cd "$WORK" && ./gradlew executableJar --console=plain -x test -x check)

# Stage the same executable as build.sh so a subsequent local Docker build
# cannot silently reuse an older docker/app/kestra left in the verify tree.
EXE="$(ls -t "$WORK"/build/executable/* | head -1)"
mkdir -p "$WORK/docker/app/storage"
cp "$EXE" "$WORK/docker/app/kestra"
chmod +x "$WORK/docker/app/kestra"
python3 "$REPO/scripts/merge-classpath.py" "$WORK/docker/app/kestra" "$REPO/extensions.tsv"
touch "$WORK/docker/app/storage/.gitkeep"
bash "$REPO/scripts/build-extensions.sh" "$WORK"

echo "== local-ci ALL GREEN（可组织 patch 提交推送，真 CI 为最终门）=="
