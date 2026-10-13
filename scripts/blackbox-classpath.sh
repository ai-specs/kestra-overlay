#!/usr/bin/env bash
# Self-contained extension-channel probe. Never checks out/builds a business plugin.
# Usage: blackbox-classpath.sh <compiled-upstream-tree> <executable-jar> <local-image>
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TREE="${1:?compiled upstream tree required}"
EXE="${2:?real executable jar required}"
IMAGE="${3:?local overlay image required}"
TASK_WORK="$(mktemp -d)"
CONTAINER="kestra-classpath-probe-$$"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$TASK_WORK"; }
trap cleanup EXIT
if [ -z "${JAVA_HOME:-}" ]; then
    JAVA_BINARY="$(command -v java)"
    if [ -x /usr/libexec/java_home ]; then JAVA_HOME="$(/usr/libexec/java_home -v 25)";
    else JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$JAVA_BINARY")")")"; fi
    export JAVA_HOME
fi
cat > "$TASK_WORK/probe.init.gradle" <<'GRADLE'
allprojects {
    afterEvaluate {
        if (path == ':webserver') {
            tasks.register('rbacProbeProcessorPath') {
                doLast { new File(System.getenv('RBAC_PROBE_CP_FILE')).text = configurations.annotationProcessor.asPath }
            }
        }
    }
}
GRADLE
(cd "$TREE" && RBAC_PROBE_CP_FILE="$TASK_WORK/processor-path" ./gradlew --init-script "$TASK_WORK/probe.init.gradle" :webserver:rbacProbeProcessorPath --console=plain)
PROCESSORS="$(cat "$TASK_WORK/processor-path")"
mkdir -p "$TASK_WORK/classes" "$TASK_WORK/libs"
"$JAVA_HOME/bin/javac" -parameters -cp "$EXE:$PROCESSORS" -processorpath "$PROCESSORS" \
    -d "$TASK_WORK/classes" "$REPO/scripts/tests/classpath-probe/RbacProbe.java"
"$JAVA_HOME/bin/jar" --create --file "$TASK_WORK/libs/kestra-rbac-authorizer.jar" -C "$TASK_WORK/classes" .
"$JAVA_HOME/bin/jar" tf "$TASK_WORK/libs/kestra-rbac-authorizer.jar" > "$TASK_WORK/entries"
rg -q 'RbacProbe.*Definition' "$TASK_WORK/entries"
rg -q 'META-INF/micronaut/' "$TASK_WORK/entries"
if [ "$IMAGE" = --compile-only ]; then
    if [ -n "${RBAC_PROBE_OUTPUT:-}" ]; then cp "$TASK_WORK/libs/kestra-rbac-authorizer.jar" "$RBAC_PROBE_OUTPUT"; fi
    echo 'PASS: independent probe compiled against real overlay SPI with Micronaut bean index'
    exit 0
fi
# The supplied image must contain the real executable with the manifest mount contract.
CONFIG='datasources:
  h2:
    url: jdbc:h2:mem:classpath-probe;DB_CLOSE_DELAY=-1
    driverClassName: org.h2.Driver
    username: sa
    password: ""
kestra:
  server-type: STANDALONE
  repository:
    type: h2
  queue:
    type: h2
  storage:
    type: local
    local:
      base-path: /tmp/kestra-storage
  plugins:
    auto-install:
      enabled: false
  rbac:
    enabled: true
    probe:
      enabled: true
micronaut:
  security:
    enabled: true
    intercept-url-map:
      - pattern: /ping
        access: [isAnonymous()]
      - pattern: /**
        access: [isAuthenticated()]'
docker run --detach --name "$CONTAINER" --publish 127.0.0.1::8080 \
    --volume "$TASK_WORK/libs:/app/libs:ro" --env "KESTRA_CONFIGURATION=$CONFIG" "$IMAGE" server standalone >/dev/null
PORT="$(docker port "$CONTAINER" 8080/tcp | sed 's/.*://')"
for attempt in $(seq 1 60); do
    if curl --silent --fail "http://127.0.0.1:$PORT/ping" >/dev/null; then break; fi
    if [ "$attempt" = 60 ]; then docker logs "$CONTAINER"; exit 1; fi
    sleep 1
done
docker logs "$CONTAINER" > "$TASK_WORK/startup.log" 2>&1
rg -q 'RBAC-CLASSPATH-PROBE-DISCOVERED' "$TASK_WORK/startup.log"
STATUS="$(curl --silent --output "$TASK_WORK/error.json" --write-out '%{http_code}' "http://127.0.0.1:$PORT/api/v1/main/flows/search")"
[ "$STATUS" = 401 ]
echo 'PASS: annotation-processed external jar discovered via executable Class-Path; anonymous REST stays 401'
