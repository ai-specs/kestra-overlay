import hashlib
import json
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import build_opener, HTTPRedirectHandler, Request


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, location):
        return None


base, server, postgres, destination = sys.argv[1:]
report = {'completed': False, 'checks': [], 'rbacEnabled': False, 'typedEnabled': False}
opener = build_opener(NoRedirect())


def check(name, condition):
    report['checks'].append({'name': name, 'passed': bool(condition)})
    if not condition:
        raise RuntimeError(name)


def request(path, fields=None, cookie=None, origin=None):
    headers = {}
    if cookie:
        headers['Cookie'] = cookie
    if origin:
        headers['Origin'] = origin
    if fields is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    value = Request(base + path, data=urlencode(fields).encode() if fields is not None else None, headers=headers)
    try:
        response = opener.open(value, timeout=30)
    except HTTPError as failure:
        response = failure
    return response.status, response.headers, response.read().decode()


def command(arguments):
    result = subprocess.run(arguments, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Controlled host probe command failed')
    return result.stdout


def state():
    query = '\n'.join('SELECT row_to_json(probe_row.*)::text FROM ' + table + ' probe_row ORDER BY row_to_json(probe_row.*)::text;'
                      for table in ['oidc_user', 'oidc_user_auth_method', 'oidc_password_change', 'oidc_authorization_code', 'oidc_token'])
    result = command(['docker', 'exec', postgres, 'psql', '-U', 'kestra', '-d', 'kestra', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query])
    return hashlib.sha256(result.encode()).hexdigest()


try:
    environment = json.loads(command(['docker', 'inspect', '--format', '{{json .Config.Env}}', server]))
    configuration = next(value.split('=', 1)[1] for value in environment if value.startswith('KESTRA_CONFIGURATION='))
    report['rbacEnabled'] = 'kestra.rbac.enabled: true' in configuration.splitlines()
    report['typedEnabled'] = 'kestra.rbac.typed.enabled: true' in configuration.splitlines()
    check('runtime-rbac-and-typed-enabled', report['rbacEnabled'] and report['typedEnabled'])
    created = json.loads(command(['docker', 'exec', server, 'java', '-cp', '/app/kestra:/tmp/directory-command.jar',
                                 'HttpDirectoryCommand', 'jdbc:postgresql://' + postgres + ':5432/kestra', 'temporary']))
    username = created['user']['subject']
    temporary = created['temporaryPassword']
    status, headers, _ = request('/oidc/login', {'username': username, 'password': temporary})
    check('temporary-login-303-password', status == 303 and headers.get('Location') == '/oidc/password')
    cookies = headers.get_all('Set-Cookie', [])
    check('temporary-login-has-no-normal-session', not any(value.startswith(('oidc_session=', 'JWT=')) and 'Max-Age=0' not in value for value in cookies))
    cookie = next(value.split(';', 1)[0] for value in cookies if value.startswith('oidc_password_change='))
    status, headers, body = request('/oidc/password', cookie=cookie)
    check('restricted-get-200-no-store', status == 200 and headers.get('Cache-Control') == 'no-store' and 'autocomplete="new-password"' in body)
    baseline = state()
    status, _, _ = request('/api/v1/main/flows/search', cookie=cookie)
    check('restricted-cookie-is-not-business-authentication', status == 401 and state() == baseline)
    status, headers, _ = request('/oidc/authorize?client_id=kestra-ui&response_type=code&redirect_uri=' + base + '/oauth/callback/kestra&scope=openid&state=password-probe', cookie=cookie)
    check('restricted-cookie-cannot-obtain-code', status in (302, 303, 307) and 'code=' not in headers.get('Location', '') and state() == baseline)
    fields = {'csrf': cookie.split('=', 1)[1], 'password': 'PasswordProbeChanged123!', 'confirmation': 'PasswordProbeChanged123!'}
    status, _, body = request('/oidc/password', fields, cookie, 'https://other.example')
    check('wrong-origin-denied-without-side-effects', status == 403 and state() == baseline and temporary not in body)
    status, _, body = request('/oidc/password', dict(fields, csrf='x' * 43), cookie, base)
    check('wrong-csrf-denied-without-side-effects', status == 403 and state() == baseline and 'name="csrf"' not in body)
    for path in ['/oidc/password/', '/oidc/%70assword', '/oidc/password/unknown']:
        status, _, _ = request(path, fields, cookie, base)
        check('path-variant-denied:' + path, status in (400, 401, 403, 404, 405) and state() == baseline)
    status, headers, _ = request('/oidc/password', fields, cookie, base)
    check('password-completed-303-login', status == 303 and headers.get('Location') == '/oidc/login')
    changed = state()
    status, _, _ = request('/oidc/password', fields, cookie, base)
    check('interaction-replay-denied-without-side-effects', status == 410 and state() == changed)
    status, headers, _ = request('/oidc/login', {'username': username, 'password': fields['password'], 'from': '/ui/'})
    check('changed-password-production-login', status == 303 and headers.get('Location') == '/ui/' and any(value.startswith('oidc_session=') for value in headers.get_all('Set-Cookie', [])))
    report['completed'] = True
finally:
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    Path(destination).write_text(json.dumps(report, indent=2))
print('PASSWORD RBAC IMAGE GREEN: ' + str(len(report['checks'])) + ' checks')
