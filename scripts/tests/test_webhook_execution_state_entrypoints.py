import unittest
from pathlib import Path
class WebhookEntrypointTests(unittest.TestCase):
    def test_both_build_entrypoints_select_test_and_use_local_script_root(self):
        repo=Path(__file__).parents[2]
        for name in ('scripts/local-ci.sh','scripts/build.sh'):
            text=(repo/name).read_text()
            self.assertIn('--tests io.kestra.core.services.AuthorizationValidationBoundaryTest',text)
            self.assertIn('--tests io.kestra.core.services.WebhookExecutionStatePropagationTest',text)
            self.assertIn('check-webhook-execution-state-tests.py',text)
            expected='python3 "$REPO/scripts/check-webhook-execution-state-tests.py"' if name=='scripts/local-ci.sh' else 'python3 "$PWD/scripts/check-webhook-execution-state-tests.py"'
            self.assertIn(expected,text)
