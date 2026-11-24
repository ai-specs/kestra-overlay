#!/usr/bin/env bash
# Shared image-gate PostgreSQL isolation. Source, then call image_pg_init DEFAULT_PASSWORD.
# Existing mode requires container, network, host port and an explicit local admin role.
image_pg_init() {
  set +x
  BB_DB=kestra BB_DB_USER=kestra BB_DB_PASSWORD="$1"
  BB_APP_NETWORK="${NET:-${RUN:-}}"
  BB_PG_ACTIVE=0 BB_PG_ROLE_CREATED=0 BB_PG_DB_CREATED=0 BB_PG_SECRET_DIR=
  local count=0 value
  for value in "${BB_EXISTING_PG_CONTAINER:-}" "${BB_EXISTING_PG_NETWORK:-}" "${BB_EXISTING_PG_PORT:-}" "${BB_EXISTING_PG_ADMIN:-}"; do
    [ -z "$value" ] || count=$((count+1))
  done
  [ -n "${BB_EXISTING_PG_CONTAINER+x}${BB_EXISTING_PG_NETWORK+x}${BB_EXISTING_PG_PORT+x}${BB_EXISTING_PG_ADMIN+x}" ] || return 0
  BB_PG_ACTIVE=1
  if [ "$count" != 4 ]; then echo 'Existing PostgreSQL requires container, network, host port and admin' >&2; return 1; fi
  [[ "$BB_EXISTING_PG_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] &&
    [[ "$BB_EXISTING_PG_NETWORK" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] &&
    [[ "$BB_EXISTING_PG_PORT" =~ ^[0-9]+$ ]] &&
    [ "$BB_EXISTING_PG_PORT" -ge 1 ] && [ "$BB_EXISTING_PG_PORT" -le 65535 ] || return 1
  BB_PG_ADMIN="${BB_EXISTING_PG_ADMIN:-}"
  [ -n "$BB_PG_ADMIN" ] || { echo 'Existing PostgreSQL requires BB_EXISTING_PG_ADMIN' >&2; return 1; }
  [[ "$BB_PG_ADMIN" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || return 1
  BB_DOCKER_BIN="${BB_DOCKER_BIN:-$(command -v docker)}"
  BB_PG_ORIGINAL="$PG"
  PG="$BB_EXISTING_PG_CONTAINER"
  BB_APP_NETWORK="$BB_EXISTING_PG_NETWORK"
  PG_PORT="$BB_EXISTING_PG_PORT"
  BB_PG_ACTIVE=1
  BB_PG_SECRET_DIR="$(mktemp -d)"
  chmod 700 "$BB_PG_SECRET_DIR"
  local token
  token="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
  BB_DB="bb_$token" BB_DB_USER="bb_$token"
  BB_DB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  BB_PG_MARKER="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  (umask 077; printf 'PGPASSWORD=%s\n' "$BB_DB_PASSWORD" > "$BB_PG_SECRET_DIR/pg.env")
  # SQL is delivered only on stdin. Never pass passwords as command arguments or print SQL errors.
  if ! image_pg_admin <<SQL
CREATE ROLE "$BB_DB_USER" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$BB_DB_PASSWORD';
SQL
  then image_pg_cleanup; return 1; fi
  BB_PG_ROLE_CREATED=1
  if ! image_pg_admin <<SQL
COMMENT ON ROLE "$BB_DB_USER" IS '$BB_PG_MARKER';
CREATE DATABASE "$BB_DB" OWNER "$BB_DB_USER";
SQL
  then image_pg_cleanup; return 1; fi
  BB_PG_DB_CREATED=1
  if ! image_pg_admin <<SQL
COMMENT ON DATABASE "$BB_DB" IS '$BB_PG_MARKER';
REVOKE ALL ON DATABASE "$BB_DB" FROM PUBLIC;
SQL
  then image_pg_cleanup; return 1; fi
  # Child processes (including the Node dependency503 checker) use the same explicit identity.
  export BB_EXISTING_PG_NETWORK BB_EXISTING_PG_PORT
  export BB_DOCKER_BIN BB_EXISTING_PG_CONTAINER BB_DB BB_DB_USER BB_PG_SECRET_DIR
  local helper
  helper="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/image-test-postgres.sh"
  (umask 077; printf '#!/usr/bin/env bash\nset -o pipefail\nsource %q\nimage_pg_docker "$@"\n' "$helper" > "$BB_PG_SECRET_DIR/docker")
  chmod 700 "$BB_PG_SECRET_DIR/docker"
  export PATH="$BB_PG_SECRET_DIR:$PATH"
}
image_pg_admin() {
  "$BB_DOCKER_BIN" exec -i "$PG" psql -X -U "$BB_PG_ADMIN" -d postgres -v ON_ERROR_STOP=1 "$@" >/dev/null 2>&1
}
image_pg_cleanup() {
  [ "${BB_PG_ACTIVE:-0}" = 1 ] || return 0
  local failed=0
  # Successful CREATE records are required. A name or comment alone never grants ownership.
  if [ "$BB_PG_DB_CREATED" = 1 ]; then
    if image_pg_admin <<SQL
DROP DATABASE "$BB_DB" WITH (FORCE);
SQL
    then BB_PG_DB_CREATED=0; else failed=1; fi
  fi
  if [ "$BB_PG_ROLE_CREATED" = 1 ] && [ "$BB_PG_DB_CREATED" = 0 ]; then
    if image_pg_admin <<SQL
DROP ROLE "$BB_DB_USER";
SQL
    then BB_PG_ROLE_CREATED=0; else failed=1; fi
  fi
  [ "$failed" = 0 ] || echo "Failed to clean isolated PostgreSQL resources: database=$BB_DB role=$BB_DB_USER" >&2
  [ -z "$BB_PG_SECRET_DIR" ] || rm -rf "$BB_PG_SECRET_DIR"
  return "$failed"
}
# UI probes run in app containers, so credentials belong in an exec env-file, not argv.
image_pg_prepare_probe_env() {
  BB_PROBE_ENV_FILE="$1"
  (umask 077
    printf 'DIRECTORY_PROBE_DB_URL=jdbc:postgresql://%s:5432/%s\nDIRECTORY_PROBE_DB_USER=%s\nDIRECTORY_PROBE_DB_PASSWORD=%s\nIDENTITY_RECHECK_DB_USER=%s\nIDENTITY_RECHECK_DB_PASSWORD=%s\n' \
      "$PG" "$BB_DB" "$BB_DB_USER" "$BB_DB_PASSWORD" "$BB_DB_USER" "$BB_DB_PASSWORD" > "$BB_PROBE_ENV_FILE"
  )
  export BB_PROBE_ENV_FILE BB_DB BB_DB_USER
}
image_pg_docker() {
  local args=("$@") i target=-1 operation=-1
  for ((i=0;i<${#args[@]};i++)); do
    [ "${args[i]}" != "$BB_EXISTING_PG_CONTAINER" ] || target=$i
    case "${args[i]}" in psql|pg_isready) operation=$i;; esac
  done
  if [ "${args[0]:-}" = exec ] && [ "$target" -ge 0 ] && [ "$operation" -gt "$target" ]; then
    local filtered=() skip=0
    for ((i=operation+1;i<${#args[@]};i++)); do
      if [ "$skip" = 1 ]; then skip=0; continue; fi
      case "${args[i]}" in -U|-d) skip=1;; *) filtered+=("${args[i]}");; esac
    done
    local stdin_args=() sql_args=()
    for ((i=1;i<target;i++)); do [ "${args[i]}" != -i ] || stdin_args=(-i); done
    [ "${args[operation]}" != psql ] || sql_args=(-v ON_ERROR_STOP=1)
    "$BB_DOCKER_BIN" exec ${stdin_args[@]+"${stdin_args[@]}"} --env-file "$BB_PG_SECRET_DIR/pg.env" "$BB_EXISTING_PG_CONTAINER" "${args[operation]}" \
      -h 127.0.0.1 -U "$BB_DB_USER" -d "$BB_DB" ${sql_args[@]+"${sql_args[@]}"} ${filtered[@]+"${filtered[@]}"}
  else
    # Cover existing Python/Node directory command callers without changing their assertions.
    if [ "${args[0]:-}" = exec ] && [ -n "${BB_PROBE_ENV_FILE:-}" ]; then
      for ((i=1;i<${#args[@]};i++)); do
        case "${args[i]}" in HttpDirectoryCommand|IdentityRecheckCommand|ProfileDirectoryCommand)
          if [[ " ${args[*]} " = *" --env-file $BB_PROBE_ENV_FILE "* ]]; then
            "$BB_DOCKER_BIN" "$@"
          else
            "$BB_DOCKER_BIN" exec --env-file "$BB_PROBE_ENV_FILE" "${args[@]:1}"
          fi
          return $?;;
        esac
      done
    fi
    # Never allow a caller to remove, restart or stop the shared PostgreSQL container.
    case "${args[0]:-}" in rm|stop|restart|kill|pause|unpause|rename|update)
      [ "$target" -lt 0 ] || { echo 'Refusing shared PostgreSQL mutation' >&2; return 1; };;
    esac
    if [ "${args[0]:-}" = logs ]; then
      "$BB_DOCKER_BIN" "$@" 2>&1 | python3 -c 'import pathlib,sys; secret=pathlib.Path(sys.argv[1]).read_text().strip().split("=",1)[1]; [sys.stdout.write(line.replace(secret,"[redacted-db-password]")) for line in sys.stdin]' "$BB_PG_SECRET_DIR/pg.env"
      return $?
    fi
    local kind='' name='' output
    case "${args[0]:-}/${args[1]:-}" in
      network/create|volume/create) kind="${args[0]}"; name="${args[${#args[@]}-1]}";;
      run/*)
        for ((i=1;i<${#args[@]}-1;i++)); do
          [ "${args[i]}" != --name ] || { kind=container; name="${args[i+1]}"; }
        done;;
    esac
    if [ -n "$kind" ]; then
      output="$("$BB_DOCKER_BIN" "$@")" || return $?
      printf '%s %s\n' "$kind" "$name" >> "$BB_PG_SECRET_DIR/resources"
      printf '%s\n' "$output"
    else
      "$BB_DOCKER_BIN" "$@"
    fi
  fi
}

# Clean only successful creates from this invocation, then verify current owner/run labels.
image_pg_resources_cleanup() {
  local kind name labels failed=0 expected="$1/$2"
  [ -n "${BB_PG_SECRET_DIR:-}" ] || return 0
  [ -f "$BB_PG_SECRET_DIR/resources" ] || return 0
  # Containers precede networks and volumes, regardless of creation order.
  local phase inventory present item processed
  for phase in container network volume; do
    processed="|"
    if [ "$phase" = container ]; then
      inventory="$("$BB_DOCKER_BIN" ps -a --format '{{.Names}}')" || { failed=1; continue; }
    else
      inventory="$("$BB_DOCKER_BIN" "$phase" ls --format '{{.Name}}')" || { failed=1; continue; }
    fi
    while read -r kind name; do
      [ "$kind" = "$phase" ] || continue
      case "$processed" in *"|$kind/$name|"*) continue;; esac
      processed="$processed$kind/$name|"
      # Only a successful inventory can establish that a previously created resource is absent.
      present=0
      while IFS= read -r item; do [ "$item" != "$name" ] || present=1; done <<< "$inventory"
      [ "$present" = 1 ] || continue
      if [ "$kind" = container ]; then
        labels="$("$BB_DOCKER_BIN" inspect --format '{{index .Config.Labels "owner"}}/{{index .Config.Labels "run"}}' "$name")" || { failed=1; continue; }
        [ "$labels" = "$expected" ] || { failed=1; continue; }
        "$BB_DOCKER_BIN" rm -f "$name" >/dev/null || failed=1
      else
        labels="$("$BB_DOCKER_BIN" "$kind" inspect --format '{{index .Labels "owner"}}/{{index .Labels "run"}}' "$name")" || { failed=1; continue; }
        [ "$labels" = "$expected" ] || { failed=1; continue; }
        "$BB_DOCKER_BIN" "$kind" rm "$name" >/dev/null || failed=1
      fi
    done < "$BB_PG_SECRET_DIR/resources"
  done
  return "$failed"
}
