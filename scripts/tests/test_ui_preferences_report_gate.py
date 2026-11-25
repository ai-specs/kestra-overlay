from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('preferences_gate', Path(__file__).parents[1] / 'check-ui-preferences-report.py')
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


def complete_report():
    hashes = {key: 'a' * 64 for key in GATE.HASH_KEYS}
    return {'schemaVersion': 1, 'total': len(GATE.EXPECTED), 'cases': [{'name': name, 'status': 'passed'} for name in GATE.EXPECTED],
            'failures': 0, 'skipped': 0, 'unrun': 0, 'inputHashes': hashes, 'finalHashes': deepcopy(hashes),
            'inputHashesUnchanged': True, 'browser': {'version': '156.0.8078.4'}, 'error': None}


class PreferenceReportTests(unittest.TestCase):
    def test_complete_named_report(self):
        self.assertEqual(GATE.check(complete_report()), 31)

    def test_missing_duplicate_reordered_or_nonpassing_case_is_rejected(self):
        for mutation in ['missing', 'duplicate', 'order', 'failed', 'skipped', 'pending']:
            with self.subTest(mutation=mutation):
                data = complete_report()
                if mutation == 'missing':
                    data['cases'].pop()
                elif mutation == 'duplicate':
                    data['cases'][1] = deepcopy(data['cases'][0])
                elif mutation == 'order':
                    data['cases'].reverse()
                else:
                    data['cases'][0]['status'] = mutation
                with self.assertRaises(ValueError):
                    GATE.check(data)

    def test_stable_boolean_cannot_hide_changed_or_missing_hashes(self):
        for mutation in ['changed', 'missing', 'invalid']:
            with self.subTest(mutation=mutation):
                data = complete_report()
                if mutation == 'changed':
                    data['finalHashes']['driver'] = 'b' * 64
                elif mutation == 'missing':
                    data['inputHashes'].pop('driver')
                else:
                    data['inputHashes']['driver'] = data['finalHashes']['driver'] = 'not-a-hash'
                with self.assertRaises(ValueError):
                    GATE.check(data)

    def test_failure_counters_error_or_missing_browser_are_rejected(self):
        for field, value in [('failures', 1), ('skipped', 1), ('unrun', 1), ('error', 'failed'), ('browser', {}), ('inputHashesUnchanged', False)]:
            with self.subTest(field=field):
                data = complete_report()
                data[field] = value
                with self.assertRaises(ValueError):
                    GATE.check(data)
