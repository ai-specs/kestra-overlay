"""Execute the real Bash helper and gates against a stateful fake Docker CLI. No containers."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / 'scripts/image-test-postgres.sh'
FAKE = r'''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
sql=sys.stdin.read() if '-i' in args else ''
p=Path(os.environ['FAKE_STATE'])
s=json.loads(p.read_text()) if p.exists() else {'events':[], 'roles':[], 'dbs':[]}
# Credential-bearing SQL never enters event logs.
s['events'].append({'args':args,'sql':sql.split()[0:2]})
fail=False
if sql.startswith('CREATE ROLE'):
 name=sql.split('"')[1]
 if os.environ.get('FAIL_SQL')=='role': fail=True
 else:s['roles'].append(name)
elif sql.startswith('COMMENT ON ROLE') and os.environ.get('FAIL_SQL')=='role_comment': fail=True
elif 'CREATE DATABASE' in sql:
 name=sql.split('CREATE DATABASE "')[1].split('"')[0]
 if os.environ.get('FAIL_SQL')=='db': fail=True
 else:s['dbs'].append(name)
elif sql.startswith('DROP DATABASE'):
 name=sql.split('"')[1];s['dbs'].remove(name)
elif sql.startswith('DROP ROLE'):
 name=sql.split('"')[1];s['roles'].remove(name)
elif sql.startswith('COMMENT ON DATABASE') and os.environ.get('FAIL_SQL')=='comment': fail=True
p.write_text(json.dumps(s))
if fail:sys.exit(9)
if args[:1]==['logs']:
 secret=Path(os.environ['BB_PG_SECRET_DIR'],'pg.env').read_text().strip().split('=',1)[1]
 print('runtime-password='+secret)
 if os.environ.get('FAIL_LOGS'):sys.exit(9)
if 'SELECT 1' in args: print('1')
if 'inspect' in args:
 if os.environ.get('FAIL_INSPECT'):sys.exit(7)
 name=args[-1]
 prior=[e['args'] for e in s['events'][:-1] if len(e['args'])>1 and e['args'][1]=='create' and e['args'][-1]==name]
 if not prior:sys.exit(1)
 labels=[a.split('=',1)[1] for a in prior[-1] if a.startswith(('owner=','run='))]
 print('foreign/owner' if os.environ.get('BAD_OWNER') else '/'.join(labels))
if (args[:1]==['ps'] or (len(args)>1 and args[1]=='ls')):
 if os.environ.get('FAIL_INVENTORY'):sys.exit(7)
 if not os.environ.get('HIDE_RESOURCES'):
  kind='container' if args[0]=='ps' else args[0]
  for e in s['events']:
   a=e['args']
   if len(a)>1 and a[:2]==[kind,'create']:
    if not any(x['args'][:2]==[kind,'rm'] and x['args'][-1]==a[-1] for x in s['events']):print(a[-1])
if args and args[0]=='run':sys.exit(8) # stop gate before any HTTP/application assertions
'''


class ImagePostgresTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        docker = self.directory / 'docker'
        docker.write_text(FAKE)
        docker.chmod(0o700)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(('BB_', 'FAIL_SQL'))}
        self.env.update(PATH=f'{self.directory}:{os.environ["PATH"]}', FAKE_STATE=str(self.directory / 'state'), TEST_HELPER_PATH=str(HELPER))

    def existing(self):
        self.env.update(BB_EXISTING_PG_CONTAINER='kestra-monorepo-postgres-1',
                        BB_EXISTING_PG_NETWORK='kestra-monorepo_default', BB_EXISTING_PG_PORT='15435',
                        BB_EXISTING_PG_ADMIN='kestra')

    def run_shell(self, body):
        return subprocess.run(['bash', '-eu', '-c', f'source "{HELPER}"\nPG=default-pg NET=gate\n{body}'],
                              env=self.env, text=True, capture_output=True)

    def state(self):
        p = self.directory / 'state'
        return json.loads(p.read_text()) if p.exists() else {'events': [], 'roles': [], 'dbs': []}

    def test_init_preserves_caller_umask_and_probe_jar_permissions(self):
        for shared in [False, True]:
            for mask in ['022', '002', '077']:
                with self.subTest(shared=shared, mask=mask):
                    if shared:
                        self.existing()
                    result = self.run_shell('''umask MASK
before="$(umask)"
image_pg_init original
trap image_pg_cleanup EXIT
test "$(umask)" = "$before"
probe_dir="$(mktemp -d)"
python3 - "$probe_dir/probe.jar" "$before" "$BB_PG_SECRET_DIR" <<'CHECK'
import pathlib, stat, sys, zipfile
probe = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(probe, 'w') as archive:
    archive.writestr('HttpDirectoryCommand.class', b'probe-test-data')
assert stat.S_IMODE(probe.stat().st_mode) == 0o666 & ~int(sys.argv[2], 8)
if int(sys.argv[2], 8) == 0o022:
    assert probe.stat().st_mode & stat.S_IROTH
if sys.argv[3]:
    secret_dir = pathlib.Path(sys.argv[3])
    assert stat.S_IMODE(secret_dir.stat().st_mode) == 0o700
    assert stat.S_IMODE((secret_dir / 'pg.env').stat().st_mode) == 0o600
probe.unlink()
probe.parent.rmdir()
CHECK
image_pg_cleanup
test "$(umask)" = "$before"
'''.replace('MASK', mask))
                    self.assertEqual(result.returncode, 0, result.stderr)

    def test_probe_exec_identity_uses_private_env_file_without_password_argv(self):
        for shared in [False, True]:
            with self.subTest(shared=shared):
                if shared:
                    self.existing()
                (self.directory / 'state').unlink(missing_ok=True)
                self.env['PROBE_TEST_ENV'] = str(self.directory / 'probe.env')
                result = self.run_shell('''image_pg_init local-test-only
trap image_pg_cleanup EXIT
image_pg_prepare_probe_env "$PROBE_TEST_ENV"
python3 - "$BB_PROBE_ENV_FILE" "$BB_DB" "$BB_DB_USER" "$BB_DB_PASSWORD" <<'CHECK'
import pathlib, stat, sys
file = pathlib.Path(sys.argv[1])
assert stat.S_IMODE(file.stat().st_mode) == 0o600
values = dict(line.split('=', 1) for line in file.read_text().splitlines())
assert values['DIRECTORY_PROBE_DB_URL'].endswith('/' + sys.argv[2])
assert values['DIRECTORY_PROBE_DB_USER'] == values['IDENTITY_RECHECK_DB_USER'] == sys.argv[3]
assert values['DIRECTORY_PROBE_DB_PASSWORD'] == values['IDENTITY_RECHECK_DB_PASSWORD'] == sys.argv[4]
CHECK
docker exec --env-file "$BB_PROBE_ENV_FILE" app java -cp host.jar HttpDirectoryCommand "jdbc:postgresql://$PG:5432/$BB_DB" temporary
if [ "$BB_PG_ACTIVE" = 1 ]; then
  for command in HttpDirectoryCommand IdentityRecheckCommand ProfileDirectoryCommand; do
    docker exec app java -cp host.jar "$command" "jdbc:postgresql://$PG:5432/kestra" reset
  done
fi
''')
                self.assertEqual(result.returncode, 0, result.stderr)
                events = [e['args'] for e in self.state()['events'] if any(command in e['args'] for command in ['HttpDirectoryCommand', 'IdentityRecheckCommand', 'ProfileDirectoryCommand'])]
                self.assertEqual(len(events), 4 if shared else 1)
                for args in events:
                    self.assertIn('--env-file', args)
                    self.assertFalse(any('PASSWORD=' in arg for arg in args))
                password = dict(line.split('=', 1) for line in (self.directory / 'probe.env').read_text().splitlines())['DIRECTORY_PROBE_DB_PASSWORD']
                self.assertNotIn(password, json.dumps(self.state()))

    def test_browser_probe_command_default_and_external_database(self):
        script = (ROOT / 'scripts/blackbox-ui-browser.cjs').read_text()
        expression = script.split('const temporary = () => ', 1)[1].split(';', 1)[0]
        node = "const process={env:JSON.parse(require('fs').readFileSync(0,'utf8'))}; const execFileSync=(file,args)=>JSON.stringify({file,args}); const temporary=()=>" + expression + "; console.log(JSON.stringify(temporary()));"
        for external in [False, True]:
            env = dict(BB_BROWSER_SERVER='app', BB_BROWSER_POSTGRES='pg')
            if external:
                env.update(BB_DB='isolated_db', BB_PROBE_ENV_FILE='/private/probe.env')
            result = subprocess.run(['node', '-e', node], input=json.dumps(env), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            args = json.loads(result.stdout)['args']
            self.assertIn('jdbc:postgresql://pg:5432/' + ('isolated_db' if external else 'kestra'), args)
            self.assertEqual('--env-file' in args, external)
        java = (ROOT / 'scripts/directory-probe/HttpDirectoryCommand.java').read_text()
        for key, default in [('URL', 'arguments[0]'), ('USER', '"kestra"'), ('PASSWORD', '"local-test-only"')]:
            self.assertIn('getOrDefault("DIRECTORY_PROBE_DB_' + key + '", ' + default + ')', java)

    def test_all_directory_command_database_entries_are_configurable(self):
        for path in (ROOT / 'scripts/directory-probe').glob('*Command.java'):
            java = path.read_text()
            if 'PGSimpleDataSource' not in java:
                continue
            with self.subTest(command=path.name):
                self.assertIn('getOrDefault("DIRECTORY_PROBE_DB_URL", arguments[0])', java)
                prefix = 'IDENTITY_RECHECK' if path.stem == 'IdentityRecheckCommand' else 'DIRECTORY_PROBE'
                self.assertIn('getOrDefault("' + prefix + '_DB_USER",', java)
                self.assertIn('getOrDefault("' + prefix + '_DB_PASSWORD",', java)
                self.assertNotIn('source.setPassword("', java)
                self.assertNotIn('source.setUser("', java)

    def test_default_unchanged(self):
        result = self.run_shell('image_pg_init local-ci-only\ntest "$PG/$BB_DB/$BB_DB_USER/$BB_DB_PASSWORD/$BB_APP_NETWORK" = default-pg/kestra/kestra/local-ci-only/gate\nimage_pg_cleanup')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state()['events'], [])

    def test_missing_or_invalid_input_has_no_docker_actions(self):
        full = dict(BB_EXISTING_PG_CONTAINER='pg', BB_EXISTING_PG_NETWORK='net',
                    BB_EXISTING_PG_PORT='15435', BB_EXISTING_PG_ADMIN='kestra')
        invalid = [{key: value} for key, value in full.items()]
        invalid += [{key: value for key, value in full.items() if key != missing} for missing in full]
        invalid += [dict(full, BB_EXISTING_PG_PORT='0'), dict(BB_EXISTING_PG_ADMIN='')]
        for values in invalid:
            with self.subTest(values=values):
                self.env.update(values)
                result = self.run_shell('trap image_pg_cleanup EXIT\nimage_pg_init original')
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.state()['events'], [])
                for key in values: self.env.pop(key)

    def test_credentials_sql_mapping_stdin_and_cleanup(self):
        self.existing()
        result = self.run_shell('''image_pg_init original
trap image_pg_cleanup EXIT
python3 - "$BB_PG_SECRET_DIR/pg.env" <<'PERMISSIONS'
import os, stat, sys
assert stat.S_IMODE(os.stat(sys.argv[1]).st_mode) == 0o600
PERMISSIONS
test "$BB_DB" = "$BB_DB_USER"
test "$BB_DB_PASSWORD" != original
docker exec "$PG" psql -U kestra -d kestra -Atc 'SELECT 1'
printf 'SELECT 2;' | docker exec -i "$PG" psql -U kestra -d kestra
if docker rm -f own-app "$PG"; then exit 99; fi
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        state = self.state()
        self.assertFalse(state['roles'] or state['dbs'])
        calls = [e for e in state['events'] if '--env-file' in e['args']]
        self.assertEqual(len(calls), 2)
        for event in calls:
            self.assertIn('ON_ERROR_STOP=1', event['args'])
            self.assertNotIn('kestra', event['args'])
            self.assertIn('127.0.0.1', event['args'])
        self.assertIn('-i', calls[1]['args'])
        self.assertFalse(any(e['args'][0] == 'rm' for e in state['events']))
        self.assertNotIn('PASSWORD=', json.dumps(state))

    def test_credentials_permissions_ignore_gnu_stat_stdout(self):
        # GNU stat -f prints filesystem data before failing on the BSD-only format.
        fake_stat = self.directory / 'stat'
        fake_stat.write_text("#!/bin/sh\nif [ \"$1\" = -f ]; then\n  printf 'File: pg.env\\nType: ext2/ext3\\n'\n  exit 1\nfi\nprintf '600\\n'\n")
        fake_stat.chmod(0o700)
        reproduction = subprocess.run(
            ['bash', '-c', 'test "$(stat -f %Lp ignored 2>/dev/null || stat -c %a ignored)" = 600'],
            env=self.env, text=True, capture_output=True)
        self.assertNotEqual(reproduction.returncode, 0)
        self.test_credentials_sql_mapping_stdin_and_cleanup()

    def test_create_failures_only_drop_successful_creates(self):
        self.existing()
        for failure, drops in [('role', []), ('role_comment', [['DROP', 'ROLE']]), ('db', [['DROP', 'ROLE']]),
                               ('comment', [['DROP', 'DATABASE'], ['DROP', 'ROLE']])]:
            with self.subTest(failure=failure):
                (self.directory / 'state').unlink(missing_ok=True)
                self.env['FAIL_SQL'] = failure
                result = self.run_shell('image_pg_init original')
                self.assertNotEqual(result.returncode, 0)
                state = self.state()
                self.assertFalse(state['roles'] or state['dbs'])
                self.assertEqual([e['sql'] for e in state['events'] if e['sql'] and e['sql'][0] == 'DROP'], drops)
                self.assertEqual(result.stdout, '')

    def test_no_create_record_never_drops_foreign_names(self):
        self.existing()
        result = self.run_shell('''BB_PG_ACTIVE=1 BB_PG_DB_CREATED=0 BB_PG_ROLE_CREATED=0
BB_DB=foreign BB_DB_USER=foreign BB_PG_SECRET_DIR="$(mktemp -d)"
image_pg_cleanup''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state()['events'], [])

    def test_registered_resource_cleanup_requires_matching_owner(self):
        self.existing()
        self.env['BAD_OWNER'] = '1'
        result = self.run_shell('''image_pg_init original
trap image_pg_cleanup EXIT
docker network create --label owner=ours --label run=gate our-network
if image_pg_resources_cleanup ours gate; then exit 99; fi
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(e['args'][:2] == ['network', 'rm'] for e in self.state()['events']))

    def test_unregistered_resources_are_never_enumerated_for_cleanup(self):
        self.existing()
        result = self.run_shell('''image_pg_init original
trap image_pg_cleanup EXIT
docker network create --label owner=ours --label run=gate our-network
image_pg_resources_cleanup ours gate
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        removals = [e['args'] for e in self.state()['events'] if e['args'][:2] == ['network', 'rm']]
        self.assertEqual(removals, [['network', 'rm', 'our-network']])
        self.assertFalse(any(e['args'][:2] == ['network', 'rm'] and e['args'][-1] != 'our-network' for e in self.state()['events']))

    def test_nested_gate_uses_original_docker_and_new_identity(self):
        self.existing()
        result = self.run_shell('''image_pg_init original
trap image_pg_cleanup EXIT
export PARENT_DATABASE="$BB_DB"
bash -eu -c 'source "$TEST_HELPER_PATH"; PG=child NET=child; image_pg_init original; trap image_pg_cleanup EXIT; test "$PARENT_DATABASE" != "$BB_DB"; docker exec "$PG" psql -U kestra -d kestra -Atc "SELECT 1"'
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.state()['roles'] or self.state()['dbs'])
        self.assertEqual(len([e for e in self.state()['events'] if e['sql'] == ['CREATE', 'ROLE']]), 2)

    def test_cleanup_inventory_and_inspect_failures_are_not_absence(self):
        self.existing()
        for failure in ['FAIL_INVENTORY', 'FAIL_INSPECT']:
            with self.subTest(failure=failure):
                (self.directory / 'state').unlink(missing_ok=True)
                self.env[failure] = '1'
                result = self.run_shell('''image_pg_init original
trap image_pg_cleanup EXIT
docker network create --label owner=ours --label run=gate our-network
if image_pg_resources_cleanup ours gate; then exit 99; fi
''')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(any(e['args'][:2] == ['network', 'rm'] for e in self.state()['events']))
                self.env.pop(failure)

    def test_successful_inventory_confirms_already_removed_resources(self):
        self.existing()
        self.env['HIDE_RESOURCES'] = '1'
        result = self.run_shell('''image_pg_init original
trap image_pg_cleanup EXIT
docker network create --label owner=ours --label run=gate our-network
docker volume create --label owner=ours --label run=gate our-volume
image_pg_resources_cleanup ours gate
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(e['args'][1:2] == ['rm'] for e in self.state()['events']))

    def test_log_redaction_preserves_docker_exit_status(self):
        self.existing()
        for fails in [False, True]:
            with self.subTest(fails=fails):
                if fails: self.env['FAIL_LOGS'] = '1'
                result = self.run_shell('''image_pg_init original
trap image_pg_cleanup EXIT
status=0
logs="$(docker logs app)" || status=$?
[[ "$logs" != *"$BB_DB_PASSWORD"* ]]
[[ "$logs" == *"[redacted-db-password]"* ]]
if [ "${FAIL_LOGS:-}" = 1 ]; then test "$status" = 9; else test "$status" = 0; fi
''')
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_recreated_app_registry_is_cleaned_once(self):
        self.existing()
        result = self.run_shell('''image_pg_init original
trap image_pg_cleanup EXIT
docker network create --label owner=ours --label run=gate our-network
printf 'network our-network\n' >> "$BB_PG_SECRET_DIR/resources"
image_pg_resources_cleanup ours gate
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len([e for e in self.state()['events'] if e['args'][:2] == ['network', 'rm']]), 1)

    def test_gate_startup_default_and_shared_mode(self):
        # Run actual gate setup until fake docker deliberately rejects first container run.
        for gate in ['oidc', 'mcp-oauth', 'ui-oidc', 'dependency503']:
            for shared in [False, True]:
                with self.subTest(gate=gate, shared=shared):
                    (self.directory / 'state').unlink(missing_ok=True)
                    for key in list(self.env):
                        if key.startswith('BB_'): self.env.pop(key)
                    if shared: self.existing()
                    sandbox = self.directory / f'{gate}-{shared}' / 'scripts'
                    sandbox.mkdir(parents=True)
                    shutil.copy2(HELPER, sandbox / HELPER.name)
                    script_name = f'blackbox-{gate}.sh'
                    shutil.copy2(ROOT / 'scripts' / script_name, sandbox / script_name)
                    args = ['bash', str(sandbox / script_name), 'test-image']
                    if gate == 'dependency503': args += ['probe.jar', str(self.directory / 'report')]
                    result = subprocess.run(args, env=self.env, text=True, capture_output=True, timeout=15)
                    self.assertNotEqual(result.returncode, 0)
                    state = self.state()
                    runs = [e['args'] for e in state['events'] if e['args'][0] == 'run']
                    self.assertEqual(len(runs), 1, result.stderr)
                    if shared:
                        self.assertNotIn('postgres:18', runs[0])
                        self.assertIn('kestra-monorepo_default', runs[0])
                        self.assertFalse(state['roles'] or state['dbs'])
                    else:
                        self.assertIn('postgres:18', runs[0])
                    self.assertFalse(any(e['args'][0] in ['rm', 'stop', 'restart'] and 'kestra-monorepo-postgres-1' in e['args'] for e in state['events']))


if __name__ == '__main__':
    unittest.main()
