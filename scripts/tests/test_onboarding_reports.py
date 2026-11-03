import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("application_gate", Path(__file__).parents[1] / "check-application-project-tests.py")
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class OnboardingReportTest(unittest.TestCase):
    def reports(self, directory):
        for suite, count in GATE.INITIAL_ACCOUNT_REQUIRED.items():
            (directory / f"TEST-{suite}.xml").write_text(
                f'<testsuite tests="{count}" failures="0" errors="0" skipped="0"/>')

    def test_initial_account_matrix_is_part_of_complete_gate(self):
        self.assertEqual(sum(GATE.INITIAL_ACCOUNT_REQUIRED.values()), 45)
        self.assertTrue(GATE.INITIAL_ACCOUNT_REQUIRED.items() <= GATE.REQUIRED.items())
        with tempfile.TemporaryDirectory() as location, contextlib.redirect_stdout(io.StringIO()):
            directory = Path(location)
            self.reports(directory)
            GATE.check(directory, GATE.INITIAL_ACCOUNT_REQUIRED)

    def test_skips_failures_reduced_counts_and_missing_reports_are_rejected(self):
        for mutation in ('tests="0"', 'skipped="1"', 'failures="1"', 'errors="1"', None):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as location:
                directory = Path(location)
                self.reports(directory)
                suite = next(iter(GATE.INITIAL_ACCOUNT_REQUIRED))
                report = directory / f"TEST-{suite}.xml"
                if mutation is None:
                    report.unlink()
                else:
                    if mutation.startswith('tests'):
                        report.write_text('<testsuite tests="0" failures="0" errors="0" skipped="0"/>')
                    else:
                        key = mutation.split('=')[0]
                        report.write_text(f'<testsuite tests="2" failures="{1 if key == "failures" else 0}" errors="{1 if key == "errors" else 0}" skipped="{1 if key == "skipped" else 0}"/>')
                with self.assertRaises(SystemExit), contextlib.redirect_stdout(io.StringIO()):
                    GATE.check(directory, GATE.INITIAL_ACCOUNT_REQUIRED)
