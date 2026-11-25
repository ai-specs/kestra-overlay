import importlib.util
import tempfile
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET
spec=importlib.util.spec_from_file_location('http_gate',Path(__file__).parents[1]/'check-http-extension-tests.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class GateTests(unittest.TestCase):
    def reports(self,root):
        for suite,names in gate.EXPECTED.items():
            xml=ET.Element('testsuite',tests=str(len(names)),failures='0',errors='0',skipped='0')
            for name in names: ET.SubElement(xml,'testcase',name=name)
            ET.ElementTree(xml).write(gate.report_path(root, suite))
    def test_exact_matrix(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.reports(root);self.assertEqual(sum(map(len,gate.EXPECTED.values())),gate.check(root))
    def test_missing_duplicate_failure_error_and_skip_rejected(self):
        for damage in ['missing','duplicate','failure','error','skipped']:
            with self.subTest(damage=damage),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);self.reports(root);file=next(root.glob('*.xml'));tree=ET.parse(file);xml=tree.getroot();case=xml.find('testcase')
                if damage=='missing':xml.remove(case)
                elif damage=='duplicate':ET.SubElement(xml,'testcase',name=case.attrib['name'])
                else:ET.SubElement(case,damage)
                tree.write(file)
                with self.assertRaises(ValueError):gate.check(root)
    def test_local_and_remote_use_same_gate(self):
        repo=Path(__file__).parents[2]
        for path in ['scripts/local-ci.sh','.github/workflows/overlay.yml']:
            self.assertIn('check-http-extension-tests.py',(repo/path).read_text())
