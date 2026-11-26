import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import subprocess
import os

SCRIPTS = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('flow_file_gate', SCRIPTS / 'check-flow-namespace-reader-tests.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class FlowNamespaceReaderGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        for classname, names in gate.EXPECTED.items():
            root = ET.Element('testsuite', name=classname, tests=str(len(names)), failures='0', errors='0', skipped='0')
            for name in sorted(names): ET.SubElement(root, 'testcase', name=name+'()', classname=classname)
            ET.ElementTree(root).write(self.directory / f'TEST-{classname}.xml')
        self.path = next(self.directory.glob('TEST-*.xml'))

    def mutate(self, change):
        tree = ET.parse(self.path); change(tree.getroot()); tree.write(self.path)
        with self.assertRaises((ValueError, OSError, ET.ParseError)): gate.check(self.directory)

    def test_exact_matrix_accepts(self): self.assertEqual(gate.check(self.directory), 14)
    def test_missing_xml_rejects(self): self.path.unlink(); self.assertRaises(OSError, gate.check, self.directory)
    def test_missing_case_rejects(self): self.mutate(lambda root: root.remove(root[0]))
    def test_duplicate_case_rejects(self): self.mutate(lambda root: root.append(ET.fromstring(ET.tostring(root[0]))))
    def test_failure_rejects(self): self.mutate(lambda root: ET.SubElement(root[0], 'failure'))
    def test_error_rejects(self): self.mutate(lambda root: ET.SubElement(root[0], 'error'))
    def test_skip_rejects(self): self.mutate(lambda root: ET.SubElement(root[0], 'skipped'))
    def test_wrong_count_rejects(self): self.mutate(lambda root: root.set('tests', '999'))
    def test_suite_failures_rejects(self): self.mutate(lambda root: root.set('failures', '1'))
    def test_wrong_classname_rejects(self): self.mutate(lambda root: root[0].set('classname', 'wrong'))

    def test_both_entrypoints_execute_exact_selector_and_checker(self):
        # Execute the actual scoped invocation with a recording gradlew and real XML checker.
        work = self.directory / 'work'; reports = work / 'webserver/build/test-results/test'; reports.mkdir(parents=True)
        for path in self.directory.glob('TEST-*.xml'): (reports / path.name).write_bytes(path.read_bytes())
        gradlew = work / 'gradlew'; gradlew.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$WORK/arguments"\n'); gradlew.chmod(0o755)
        for name, variable in [('build.sh', 'PWD'), ('local-ci.sh', 'REPO')]:
            text = (SCRIPTS / name).read_text()
            lines = text.splitlines()
            invocations = [i for i, line in enumerate(lines) if './gradlew :webserver:test' in line]
            self.assertEqual(len(invocations), 2)
            index = invocations[1]
            end = next(i for i in range(index, len(lines)) if lines[i].endswith('--console=plain)'))
            invocation = '\n'.join(lines[index:end+1])
            self.assertIn("--tests 'io.kestra.webserver.rbac.*'", invocation)
            self.assertIn('--tests io.kestra.webserver.rbac.FlowNamespaceFileReaderV1Test', invocation)
            self.assertIn('--tests io.kestra.webserver.rbac.FlowNamespaceFileReaderHttpTest', invocation)
            self.assertEqual(text.count('--tests io.kestra.webserver.rbac.FlowNamespaceFileReaderV1Test'), 1)
            checker = next(line for line in lines if 'scripts/check-flow-namespace-reader-tests.py' in line)
            self.assertLess(lines.index(checker), next(i for i, line in enumerate(lines) if './gradlew :core:test' in line))
            block = invocation + '\n' + checker
            self.assertIn(f'"${variable}/scripts/check-flow-namespace-reader-tests.py"', block)
            env = dict(os.environ, WORK=str(work), REPO=str(SCRIPTS.parent), TESTS='io.kestra.webserver.oidc.*')
            result = subprocess.run(['bash', '-eu', '-c', block], cwd=SCRIPTS.parent, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('REQ-0414 14 exact named cases', result.stdout)
            arguments = (work/'arguments').read_text().splitlines()
            self.assertEqual(arguments.count(':webserver:test'), 1)
            self.assertIn('io.kestra.webserver.rbac.FlowNamespaceFileReaderV1Test', arguments)
            self.assertIn('io.kestra.webserver.rbac.FlowNamespaceFileReaderHttpTest', arguments)
            self.assertIn('io.kestra.mcp.McpExecutionGateTest', arguments)
            self.assertIn('--tests io.kestra.core.services.AuthorizationValidationBoundaryTest --tests io.kestra.core.services.WebhookExecutionStatePropagationTest', text)

if __name__ == '__main__': unittest.main()
