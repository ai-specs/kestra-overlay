import http.cookiejar
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import build_opener, HTTPCookieProcessor, HTTPRedirectHandler, Request

base, server, postgres, output = sys.argv[1:]
report = {'completed': False, 'checks': [], 'httpTrace': [], 'expectedChecks': 26, 'scope': 'host-public-V2-and-production-OAuth-not-plugin-management-HTTP'}
path = Path(output)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(report, indent=2) + '\n')


def check(name, passed):
    report['checks'].append({'name': name, 'passed': passed})
    if not passed:
        raise AssertionError(name)
    print('PASS: profile ' + name)


def command(arguments):
    result = subprocess.run(arguments, capture_output=True, text=True)
    if result.returncode:
        if result.stdout.strip().startswith('{'):
            partial = json.loads(result.stdout)
            report['checks'].extend(partial.get('checks', []))
        raise RuntimeError('Controlled profile probe command failed')
    return result.stdout


class LogoutResponse(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        report['httpTrace'].append({'sourcePath': urlparse(request.full_url).path, 'status': code,
                                   'locationPath': urlparse(new_url).path, 'contentType': headers.get('Content-Type')})
        if urlparse(request.full_url).path == '/oidc/logout':
            return None
        return super().redirect_request(request, response, code, message, headers, new_url)


try:
    with tempfile.TemporaryDirectory(prefix='host-profile-') as temporary:
        work = Path(temporary)
        command(['docker', 'cp', server + ':/app/kestra', str(work / 'host.jar')])
        command(['javac', '-proc:none', '-cp', str(work / 'host.jar'), '-d', str(work), str(Path(__file__).with_name('ProfileDirectoryCommand.java'))])
        command(['jar', '--create', '--file', str(work / 'profile-probe.jar'), '-C', str(work), 'ProfileDirectoryCommand.class'])
        command(['docker', 'cp', str(work / 'profile-probe.jar'), server + ':/tmp/profile-probe.jar'])

        def invoke(action, subject=None):
            values = ['docker', 'exec', server, 'java', '-cp', '/app/kestra:/tmp/profile-probe.jar', 'ProfileDirectoryCommand',
                      'jdbc:postgresql://' + postgres + ':5432/kestra', action]
            if subject:
                values.append(subject)
            return json.loads(command(values))

        subject = invoke('create')['subject']
        opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()), LogoutResponse())

        def login():
            with opener.open(base + '/oauth/login/kestra', timeout=30) as response:
                login_url = response.url
            origin = parse_qs(urlparse(login_url).query).get('from', [''])[0]
            with opener.open(Request(base + '/oidc/login', data=urlencode({'username': subject, 'password': 'ProfileProbeInitial123!', 'from': origin}).encode(), headers={'Accept': '*/*'}), timeout=30) as response:
                return response.status

        check('production-login-before-profile-update', login() == 200)
        with opener.open(Request(base + '/api/v1/configs', headers={'Accept': 'application/json'}), timeout=30) as response:
            check('normal-ui-cookie-before-profile-update', response.status == 200)
        result = invoke('check', subject)
        report['checks'].extend(result['checks'])
        check('public-directory-probe-completed-21-checks', result['completed'] and len(result['checks']) == 21 and all(item['passed'] for item in result['checks']))
        with opener.open(Request(base + '/api/v1/configs', headers={'Accept': 'application/json'}), timeout=30) as response:
            check('existing-ui-cookie-survives-profile-update', response.status == 200)
        try:
            opener.open(Request(base + '/oidc/logout', headers={'Accept': 'application/json'}), timeout=30)
            raise AssertionError('logout did not return its protocol redirect')
        except HTTPError as response:
            report['logoutResponse'] = {'path': urlparse(response.url).path, 'status': response.code,
                                        'location': response.headers.get('Location'),
                                        'contentType': response.headers.get('Content-Type')}
            if response.code != 307 or response.headers.get('Location') != '/ui/':
                raise AssertionError('logout failed') from None
            cleared = response.headers.get_all('Set-Cookie', [])
            if not all(any(cookie.startswith(name + '=') and 'max-age=0' in cookie.lower() for cookie in cleared)
                       for name in ['JWT', 'oidc_session']):
                raise AssertionError('logout did not clear authentication cookies')
            report['logoutResponse']['clearedCookieNames'] = ['JWT', 'oidc_session']
        check('same-password-production-relogin-with-empty-profile', login() == 200)
        if len(report['checks']) != report['expectedChecks']:
            raise AssertionError('profile matrix count mismatch')
        report['completed'] = True
finally:
    path.write_text(json.dumps(report, indent=2) + '\n')
