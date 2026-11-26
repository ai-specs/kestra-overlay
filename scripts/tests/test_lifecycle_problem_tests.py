import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('lifecycle_gate', Path(__file__).parents[1] / 'check-lifecycle-problem-tests.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class LifecycleProblemGateTests(unittest.TestCase):
    def write(self, directory):
        suite = ET.Element('testsuite', tests='6', failures='0', errors='0', skipped='0')
        for name in sorted(gate.EXPECTED):
            ET.SubElement(suite, 'testcase', name=name + '()')
        path = directory / gate.REPORT
        ET.ElementTree(suite).write(path)
        return path

    def test_exact_matrix_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write(root)
            self.assertEqual(gate.check(root), 6)

    def test_missing_report_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(OSError):
                gate.check(directory)

    def test_mutated_matrix_fails(self):
        for mutation in ('missing', 'duplicate', 'unknown', 'count', 'failure', 'error', 'skipped', 'header_failure', 'header_error', 'header_skip', 'malformed'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = self.write(root)
                tree = ET.parse(path)
                suite = tree.getroot()
                case = suite.find('testcase')
                if mutation == 'missing':
                    suite.remove(case)
                elif mutation == 'duplicate':
                    suite.findall('testcase')[1].set('name', case.attrib['name'])
                elif mutation == 'unknown':
                    case.set('name', 'unknown')
                elif mutation == 'count':
                    suite.set('tests', '5')
                elif mutation in ('failure', 'error', 'skipped'):
                    ET.SubElement(case, mutation)
                elif mutation.startswith('header_'):
                    suite.set({'header_failure': 'failures', 'header_error': 'errors', 'header_skip': 'skipped'}[mutation], '1')
                tree.write(path)
                if mutation == 'malformed':
                    path.write_text('<invalid')
                with self.assertRaises((ValueError, ET.ParseError)):
                    gate.check(root)
