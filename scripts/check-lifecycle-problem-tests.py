"""Require the exact non-PostgreSQL REQ-0415 HTTP regression matrix."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

EXPECTED = {
    'dependencyGetHasSixSafeProblemFieldsAndNoHandler',
    'dependencyPostHasSixSafeProblemFieldsAndNoHandler',
    'dependencyHtmlStill503WithoutLogoutRedirect',
    'revokedSessionRemains401WithoutHandler',
    'ordinaryForbiddenRemains403',
    'healthyRequestAndRecoveryReachHandler',
}
REPORT = 'TEST-io.kestra.webserver.oidc.controllers.OidcLifecycleProblemHttpTest.xml'


def check(directory):
    root = ET.parse(Path(directory) / REPORT).getroot()
    cases = root.findall('testcase')
    names = [case.attrib.get('name', '').removesuffix('()') for case in cases]
    if (root.tag != 'testsuite' or set(names) != EXPECTED or len(names) != len(EXPECTED)
            or int(root.attrib.get('tests', '0')) != len(EXPECTED)
            or any(int(root.attrib.get(key, '0')) for key in ('failures', 'errors', 'skipped'))
            or any(case.find(tag) is not None for case in cases for tag in ('failure', 'error', 'skipped'))):
        raise ValueError('REQ-0415 requires exact six named HTTP cases with zero failure/error/skip')
    return len(cases)


if __name__ == '__main__':
    try:
        print(f'PASS: REQ-0415 {check(sys.argv[1])} exact HTTP cases, zero failures/errors/skips')
    except (OSError, ValueError, ET.ParseError) as failure:
        raise SystemExit(f'FAIL: {failure}')
