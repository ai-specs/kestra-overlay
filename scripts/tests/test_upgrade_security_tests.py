import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET


SPEC = importlib.util.spec_from_file_location("upgrade_security", Path(__file__).parents[1] / "check-upgrade-security-tests.py")
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class UpgradeSecurityReportTests(unittest.TestCase):
    def test_exact_names_and_zero_failures_are_required(self):
        for selected in GATE.REQUIRED:
            for mutation in ("valid", "missing", "duplicate", "failure", "error", "skipped", "reduced"):
                with self.subTest(module=selected, mutation=mutation), tempfile.TemporaryDirectory() as directory:
                    for module, (suite, names) in GATE.REQUIRED.items():
                        output = Path(directory) / module / "xml"
                        output.mkdir(parents=True)
                        report = ET.Element("testsuite", tests=str(len(names)), failures="0", errors="0", skipped="0")
                        for name in sorted(names):
                            ET.SubElement(report, "testcase", name=name + "()")
                        if module == selected:
                            if mutation == "missing":
                                continue
                            if mutation == "duplicate":
                                report[0].set("name", "unexpected()")
                            if mutation in ("failure", "error", "skipped"):
                                ET.SubElement(report[0], mutation)
                            if mutation == "reduced":
                                report.set("tests", str(len(names) - 1))
                        ET.ElementTree(report).write(output / f"TEST-{suite}.xml")
                    with contextlib.redirect_stdout(io.StringIO()):
                        if mutation == "valid":
                            GATE.check(directory)
                        else:
                            with self.assertRaises((SystemExit, FileNotFoundError)):
                                GATE.check(directory)
