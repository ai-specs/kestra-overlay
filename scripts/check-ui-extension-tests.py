"""Require the complete host UI lifecycle and SDK matrix in the Vitest JSON report."""
import json
from pathlib import Path
import sys


REQUIRED = {
    "src/extensions/app-entry.spec.ts": 3,
    "src/extensions/entry.spec.ts": 36,
    "src/extensions/fallback-layout.spec.ts": 1,
    "src/extensions/main-entry.spec.ts": 7,
    "src/extensions/navigation.spec.ts": 6,
    "src/extensions/runtime.spec.ts": 8,
    "src/extensions/sdk.spec.ts": 7,
    "src/extensions/shadow-overlays.spec.ts": 19,
    "src/extensions/system-theme.spec.ts": 4,
    "src/utils/authentication.spec.ts": 2,
}


def check(report):
    expected = sum(REQUIRED.values())
    if not report.get("success") or any(report.get(key, 0) for key in
                                        ("numFailedTests", "numPendingTests", "numTodoTests")):
        raise SystemExit("FAIL: UI unit report must succeed without failures, pending or todo tests")
    if report.get("numTotalTests") != expected or report.get("numPassedTests") != expected:
        raise SystemExit(f"FAIL: UI unit report must execute {expected} passing tests")
    suites = report.get("testResults", [])
    if len(suites) != len(REQUIRED):
        raise SystemExit(f"FAIL: UI unit report must contain exactly {len(REQUIRED)} files")
    for filename, count in REQUIRED.items():
        matches = [suite for suite in suites if str(suite.get("name", "")).replace("\\", "/").endswith("/" + filename)]
        if len(matches) != 1:
            raise SystemExit("FAIL: missing or duplicate UI unit report: " + filename)
        suite = matches[0]
        assertions = suite.get("assertionResults", [])
        if suite.get("status") != "passed" or len(assertions) != count or any(
                assertion.get("status") != "passed" for assertion in assertions):
            raise SystemExit(f"FAIL: {filename} must execute {count} tests without failures or skips")
        print(f"PASS: {filename}: {count} tests executed, no failures or skips")


if __name__ == "__main__":
    check(json.loads(Path(sys.argv[1]).read_text()))
