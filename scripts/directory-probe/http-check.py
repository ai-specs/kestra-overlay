import argparse
import json
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('base')
parser.add_argument('server')
parser.add_argument('postgres')
parser.add_argument('report', type=Path)
arguments = parser.parse_args()
report = {'completed': False, 'checks': []}


def command(values):
    completed = subprocess.run(values, capture_output=True, text=True)
    if completed.returncode:
        raise RuntimeError('Controlled command failed: ' + completed.stderr[:400])
    return completed.stdout


try:
    with tempfile.TemporaryDirectory(prefix='directory-http-') as temporary:
        work = Path(temporary)
        host = work / 'host.jar'
        command(['docker', 'cp', arguments.server + ':/app/kestra', str(host)])
        command(['javac', '-proc:none', '-cp', str(host), '-d', str(work),
            str(Path(__file__).with_name('HttpDirectoryCommand.java'))])
        helper = work / 'directory-command.jar'
        command(['jar', '--create', '--file', str(helper), '-C', str(work), 'HttpDirectoryCommand.class'])
        command(['docker', 'cp', str(helper), arguments.server + ':/tmp/directory-command.jar'])
        cookies = work / 'cookies'
        saved = work / 'old-cookies'

        def request(path, expected, name, data=None, follow=False, saved_cookies=False):
            values = ['curl', '-sS', '-o', str(work / 'body'), '-D', str(work / 'headers'), '-w', '%{http_code}',
                '-b', str(saved if saved_cookies else cookies), '-c', str(work / 'ignored' if saved_cookies else cookies)]
            if follow:
                values.append('--location')
            for key, value in (data or {}).items():
                values.extend(['--data-urlencode', key + '=' + value])
            values.append(path if path.startswith('http') else arguments.base + path)
            status = int(command(values))
            allowed = expected if isinstance(expected, tuple) else (expected,)
            report['checks'].append({'name': name, 'status': status, 'passed': status in allowed})
            if status not in allowed:
                raise RuntimeError(name + ': expected ' + str(allowed) + ', received ' + str(status))
            print('PASS: directory HTTP ' + name)
            return (work / 'headers').read_text()

        def login(password):
            headers = request('/oauth/login/kestra', 302, 'new OAuth state')
            authorize = next(line.split(':', 1)[1].strip() for line in headers.splitlines() if line.lower().startswith('location:'))
            request(authorize, 200, 'login form', follow=True)
            request('/oidc/login', 200, 'password and complete callback', data={
                'username': 'tester', 'password': password, 'from': urlparse(authorize).path + '?' + urlparse(authorize).query}, follow=True)
            request('/api/v1/configs', 200, 'fresh cookie authenticated')

        def mutate(action):
            command(['docker', 'exec', arguments.server, 'java', '-cp', '/app/kestra:/tmp/directory-command.jar',
                'HttpDirectoryCommand', 'jdbc:postgresql://' + arguments.postgres + ':5432/kestra', action])

        login('Passw0rd!')
        saved.write_bytes(cookies.read_bytes())
        mutate('disable')
        request('/api/v1/configs', 401, 'disabled old UI cookie denied', saved_cookies=True)
        request('/oidc/clients', (401, 403), 'disabled IdP session denied', saved_cookies=True)
        mutate('enable')
        request('/api/v1/configs', 401, 'reactivation does not revive old UI cookie', saved_cookies=True)
        login('Passw0rd!')
        saved.write_bytes(cookies.read_bytes())
        mutate('reset')
        request('/api/v1/configs', 401, 'password reset invalidates UI cookie', saved_cookies=True)
        request('/oidc/clients', (401, 403), 'password reset invalidates IdP session', saved_cookies=True)
        request('/oidc/login', 401, 'old password denied', data={'username': 'tester', 'password': 'Passw0rd!'})
        login('DirectoryReset123!')
        mutate('restore')
        login('Passw0rd!')
        report['completed'] = True
finally:
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    arguments.report.write_text(json.dumps(report, indent=2) + '\n')
