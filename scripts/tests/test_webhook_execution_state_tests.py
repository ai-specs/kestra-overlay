import importlib.util
import tempfile
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET
spec=importlib.util.spec_from_file_location('gate',Path(__file__).parents[1]/'check-webhook-execution-state-tests.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class WebhookGateTests(unittest.TestCase):
    def write(self,root,tests=4,**attrs):
        names=sorted(gate.EXPECTED);suite=ET.Element('testsuite',tests=str(tests),failures='0',errors='0',skipped='0',**{k:str(v) for k,v in attrs.items()})
        for name in names:ET.SubElement(suite,'testcase',name=name)
        ET.ElementTree(suite).write(root/'TEST-io.kestra.core.services.WebhookExecutionStatePropagationTest.xml')
    def test_valid_matrix_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.write(root);self.assertEqual(gate.check(root),4)
    def test_missing_duplicate_failure_error_skip_and_count_fail(self):
        for mutation in ('missing','duplicate','failure','error','skip','count'):
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);self.write(root);file=next(root.iterdir());tree=ET.parse(file);suite=tree.getroot();case=suite.find('testcase')
                if mutation=='missing':suite.remove(case)
                elif mutation=='duplicate':ET.SubElement(suite,'testcase',name=case.attrib['name'])
                elif mutation in ('failure','error'):ET.SubElement(case,mutation)
                elif mutation=='skip':ET.SubElement(case,'skipped')
                else:suite.set('tests','3')
                tree.write(file)
                with self.assertRaises(ValueError):gate.check(root)
