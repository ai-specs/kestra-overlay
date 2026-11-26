from pathlib import Path
import re
import unittest


class NamespaceScopeEvidenceRetentionTest(unittest.TestCase):
    def test_final_webserver_invocation_retains_scope_suite_and_rechecks_reports(self):
        repository = Path(__file__).resolve().parents[2]
        for name, variable in [('build.sh', 'PWD'), ('local-ci.sh', 'REPO')]:
            with self.subTest(entrypoint=name):
                source = (repository / 'scripts' / name).read_text()
                invocations = list(re.finditer(r'\(cd "\$WORK" && ./gradlew :webserver:test.*?--console=plain\)', source, re.S))
                self.assertTrue(invocations)
                final = invocations[-1]
                self.assertIn('--tests io.kestra.mcp.McpToolScopeTest', final.group())
                self.assertIn("--tests 'io.kestra.webserver.rbac.*'", final.group())
                expected = f'python3 "${variable}/scripts/check-namespace-scope-tests.py" "$WORK/webserver/build/test-results/test"'
                self.assertIn(expected, source[final.end():])
