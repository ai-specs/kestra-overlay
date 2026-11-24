import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("application_gate", Path(__file__).parents[1] / "check-application-project-tests.py")
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)
SUITE = "io.kestra.mcp.McpSessionLifecycleTest"


class McpLifecycleGateTest(unittest.TestCase):
    def test_background_refresh_requires_six_exact_successful_cases(self):
        suite = "io.kestra.mcp.McpBackgroundRefreshContextTest"
        self.assertEqual(GATE.REQUIRED[suite], 6)
        for mutation in ("valid", "missing", "skip", "failure", "error", "reduced", "renamed", "duplicate"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as location:
                directory = Path(location)
                names = sorted(GATE.MCP_BACKGROUND_REFRESH_REQUIRED)
                if mutation == "reduced": names.pop()
                if mutation == "renamed": names[0] = "wrong-case"
                if mutation == "duplicate": names[0] = names[1]
                cases = "".join(f'<testcase name="{name}()"/>' for name in names)
                if mutation != "missing":
                    (directory / f"TEST-{suite}.xml").write_text(
                        f'<testsuite tests="{len(names)}" skipped="{int(mutation == "skip")}" '
                        f'failures="{int(mutation == "failure")}" errors="{int(mutation == "error")}">{cases}</testsuite>')
                with contextlib.redirect_stdout(io.StringIO()):
                    if mutation == "valid":
                        GATE.check(directory, {suite: 6})
                    else:
                        with self.assertRaises(SystemExit): GATE.check(directory, {suite: 6})

    def report(self, directory, *, skip=0, failure=0, error=0, names=None):
        names = sorted(GATE.MCP_LIFECYCLE_REQUIRED) if names is None else names
        cases = "".join(f'<testcase name="{name}()"/>' for name in names)
        (directory / f"TEST-{SUITE}.xml").write_text(
            f'<testsuite tests="{len(names)}" skipped="{skip}" failures="{failure}" errors="{error}">{cases}</testsuite>')

    def test_complete_seventeen_named_cases_are_required(self):
        self.assertEqual(GATE.REQUIRED[SUITE], 17)
        with tempfile.TemporaryDirectory() as location, contextlib.redirect_stdout(io.StringIO()):
            directory = Path(location)
            self.report(directory)
            GATE.check(directory, {SUITE: 17})

    def test_missing_skipped_failed_error_reduced_or_renamed_cases_fail(self):
        for mutation in ("missing", "skip", "failure", "error", "reduced", "renamed"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as location:
                directory = Path(location)
                names = sorted(GATE.MCP_LIFECYCLE_REQUIRED)
                if mutation == "reduced": names.pop()
                if mutation == "renamed": names[0] = "wrong-case"
                if mutation != "missing":
                    self.report(directory, skip=int(mutation == "skip"), failure=int(mutation == "failure"),
                                error=int(mutation == "error"), names=names)
                with self.assertRaises(SystemExit), contextlib.redirect_stdout(io.StringIO()):
                    GATE.check(directory, {SUITE: 17})

    def test_transport_gate_requires_original_and_six_upstream_security_cases(self):
        suite = "io.kestra.mcp.KestraFluxStreamableServerTransportProviderTest"
        self.assertEqual(GATE.REQUIRED[suite], 23)
        for bad in (False, True):
            with tempfile.TemporaryDirectory() as location, contextlib.redirect_stdout(io.StringIO()):
                directory = Path(location)
                names = sorted(GATE.MCP_TRANSPORT_REQUIRED)
                if bad: names[0] = "wrong-case"
                cases = "".join(f'<testcase name="{name}()"/>' for name in names)
                (directory / f"TEST-{suite}.xml").write_text(f'<testsuite tests="23" skipped="0" errors="0" failures="0">{cases}</testsuite>')
                if bad:
                    with self.assertRaises(SystemExit): GATE.check(directory, {suite: 23})
                else: GATE.check(directory, {suite: 23})
