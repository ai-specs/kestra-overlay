import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("gate", Path(__file__).parents[1] / "check-application-project-tests.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class UpgradeReportTests(unittest.TestCase):
    def test_upstream_migration_and_repository_reports_are_mandatory(self):
        for required in (gate.UPSTREAM_MIGRATION_REQUIRED, gate.MCP_REPOSITORY_REQUIRED):
            for suite, count in required.items():
                for mutation in ("valid", "missing", "reduced", "failure", "error", "skip"):
                    with self.subTest(suite=suite, mutation=mutation), tempfile.TemporaryDirectory() as directory:
                        location = Path(directory)
                        if mutation != "missing":
                            (location / f"TEST-{suite}.xml").write_text(
                                f'<testsuite tests="{count - int(mutation == "reduced")}" failures="{int(mutation == "failure")}" errors="{int(mutation == "error")}" skipped="{int(mutation == "skip")}"/>')
                        with contextlib.redirect_stdout(io.StringIO()):
                            if mutation == "valid": gate.check(location, required)
                            else:
                                with self.assertRaises(SystemExit): gate.check(location, required)
