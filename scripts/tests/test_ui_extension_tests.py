import contextlib
import copy
import importlib.util
import io
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location("ui_extension_gate", Path(__file__).parents[1] / "check-ui-extension-tests.py")
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class UiExtensionReportTest(unittest.TestCase):
    def report(self):
        count = sum(GATE.REQUIRED.values())
        return {"success": True, "numTotalTests": count, "numPassedTests": count,
                "numFailedTests": 0, "numPendingTests": 0,
                "testResults": [{"name": "/verified/ui/" + filename, "status": "passed",
                                 "assertionResults": [{"status": "passed"} for index in range(size)]}
                                for filename, size in GATE.REQUIRED.items()]}

    def test_accepts_complete_host_and_sdk_matrix(self):
        with contextlib.redirect_stdout(io.StringIO()):
            GATE.check(self.report())

    def test_requires_exact_added_shadow_tests(self):
        self.assertEqual(sum(GATE.REQUIRED.values()), 89)
        self.assertEqual(GATE.REQUIRED["src/extensions/shadow-overlays.spec.ts"], 15)
        report = self.report()
        suite = next(item for item in report["testResults"] if item["name"].endswith("shadow-overlays.spec.ts"))
        suite["assertionResults"] = suite["assertionResults"][:13]
        with self.assertRaises(SystemExit), contextlib.redirect_stdout(io.StringIO()):
            GATE.check(report)

    def test_rejects_missing_or_duplicate_files(self):
        for mutation in (lambda suites: suites.pop(), lambda suites: suites.__setitem__(1, copy.deepcopy(suites[0]))):
            report = self.report()
            mutation(report["testResults"])
            with self.assertRaises(SystemExit), contextlib.redirect_stdout(io.StringIO()):
                GATE.check(report)

    def test_rejects_skipped_assertion_even_when_totals_claim_success(self):
        report = self.report()
        report["testResults"][0]["assertionResults"][0]["status"] = "pending"
        with self.assertRaises(SystemExit), contextlib.redirect_stdout(io.StringIO()):
            GATE.check(report)

    def test_rejects_failed_pending_or_reduced_totals(self):
        for field, value in (("success", False), ("numFailedTests", 1), ("numPendingTests", 1),
                             ("numTotalTests", 88), ("numPassedTests", 88)):
            report = self.report()
            report[field] = value
            with self.assertRaises(SystemExit), contextlib.redirect_stdout(io.StringIO()):
                GATE.check(report)
