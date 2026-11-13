from pathlib import Path
import unittest


class McpLifecycleEntrypointsTest(unittest.TestCase):
    def test_ci_and_local_select_both_required_mcp_suites(self):
        scripts = Path(__file__).parents[1]
        for name in ("build.sh", "local-ci.sh"):
            text = (scripts / name).read_text()
            for suite in ("io.kestra.mcp.McpSessionLifecycleTest", "io.kestra.mcp.KestraFluxStreamableServerTransportProviderTest"):
                with self.subTest(entrypoint=name, suite=suite):
                    self.assertIn("--tests " + suite, text)
