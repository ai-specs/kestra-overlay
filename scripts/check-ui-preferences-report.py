#!/usr/bin/env python3
import json
from pathlib import Path
import re
import sys

LOCALES = ['en', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pl', 'pt', 'pt_BR', 'ru', 'zh_CN']
EXPECTED = [f'theme:{theme}:{system}' for system in ['light', 'dark']
            for theme in ['missing', 'light', 'dark', 'dark-2', 'syncWithSystem']]
EXPECTED += ['locale:' + locale for locale in ['missing', 'empty', *LOCALES, 'pt-BR', 'zh-CN', 'unsupported-locale']]
EXPECTED += ['refresh', 'cross-document-storage', 'writer-own-document-no-storage-event']
HASH_KEYS = {'ui/src/utils/utils.ts', 'webserver/src/main/resources/META-INF/kestra/ui-sdk/v1/contract.json', 'driver'}


def check(data):
    cases = data.get('cases', [])
    if data.get('schemaVersion') != 1 or data.get('total') != len(EXPECTED):
        raise ValueError('Preference report version or count differs')
    if [case.get('name') for case in cases] != EXPECTED:
        raise ValueError('Exact unique ordered preference matrix required')
    if any(case.get('status') != 'passed' for case in cases):
        raise ValueError('Preference case failed, skipped or not run')
    if any(data.get(key) != 0 for key in ['failures', 'skipped', 'unrun']) or data.get('error'):
        raise ValueError('Preference report contains failure or missing completion counters')
    before, after = data.get('inputHashes'), data.get('finalHashes')
    if not isinstance(before, dict) or set(before) != HASH_KEYS or before != after:
        raise ValueError('Preference driver or native inputs changed')
    if not all(isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) for value in before.values()):
        raise ValueError('Preference input SHA-256 missing or invalid')
    if data.get('inputHashesUnchanged') is not True:
        raise ValueError('Preference input integrity did not complete')
    version = data.get('browser', {}).get('version')
    if not isinstance(version, str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+){3}', version):
        raise ValueError('Actual Chromium version required')
    return len(EXPECTED)


if __name__ == '__main__':
    try:
        count = check(json.loads(Path(sys.argv[1]).read_text()))
    except (ValueError, OSError) as failure:
        raise SystemExit('FAIL: ' + str(failure))
    print(f'PASS: UI preference report {count} exact cases, stable hashes, browser version recorded')
