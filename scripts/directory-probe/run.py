import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
import zipfile


parser = argparse.ArgumentParser()
parser.add_argument('--host-jar', required=True, type=Path)
parser.add_argument('--host-sha256', required=True)
arguments = parser.parse_args()
repository = Path(__file__).resolve().parents[2]
work = repository / '.work/directory-probe' / uuid.uuid4().hex[:12]
work.mkdir(parents=True)
container = 'rbac-directory-probe-' + work.name
report = {'completed': False, 'checks': []}


def run(name, command, **options):
    result = subprocess.run(command, capture_output=True, text=True, **options)
    (work / (name + '.log')).write_text(result.stdout + result.stderr)
    report['checks'].append({'name': name, 'exit_code': result.returncode})
    if result.returncode:
        raise RuntimeError(name + ' failed; inspect ' + str(work / (name + '.log')))
    return result.stdout


try:
    host = arguments.host_jar.resolve(strict=True)
    with host.open('rb') as source:
        report['host_sha256'] = hashlib.file_digest(source, 'sha256').hexdigest()
    if report['host_sha256'] != arguments.host_sha256:
        raise RuntimeError('published host hash mismatch')
    run('create', ['docker', 'run', '--detach', '--rm', '--name', container,
        '--env', 'POSTGRES_PASSWORD=probe-only', '--publish', '127.0.0.1::5432', 'postgres:18'])
    deadline = time.monotonic() + 60
    while True:
        readiness = subprocess.run(['docker', 'exec', container, 'pg_isready', '-U', 'postgres'], capture_output=True)
        if readiness.returncode == 0:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError('isolated database did not become ready')
        time.sleep(0.2)
    port = run('port', ['docker', 'port', container, '5432/tcp']).strip().rsplit(':', 1)[1]
    with zipfile.ZipFile(host) as archive:
        migrations = sorted(name for name in archive.namelist()
            if name.startswith('migrations/2.0.9') and name.endswith('postgres.sql'))
        if not migrations:
            raise RuntimeError('published OIDC migrations absent')
        for migration in migrations:
            run(Path(migration).stem, ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                input=archive.read(migration).decode())
    run('compile', ['javac', '-proc:none', '-cp', str(host), '-d', str(work),
        str(Path(__file__).with_name('DirectoryProbe.java'))])
    environment = dict(os.environ, DIRECTORY_PROBE_JDBC='jdbc:postgresql://127.0.0.1:' + port + '/postgres')
    output = run('probe', ['java', '-cp', os.pathsep.join((str(work), str(host))), 'DirectoryProbe'], env=environment)
    if 'DIRECTORY COMPONENT PROBE PASS' not in output:
        raise RuntimeError('completion marker absent')
    print(output, end='')
    report['completed'] = True
finally:
    cleanup = subprocess.run(['docker', 'rm', '-f', container], capture_output=True, text=True)
    report['cleanup_exit_code'] = cleanup.returncode
    (work / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Evidence: ' + str(work))
