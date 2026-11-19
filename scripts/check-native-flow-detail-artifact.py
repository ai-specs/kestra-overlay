"""Audit the downloaded native detail artifact without a host build or external plugin."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

root = Path(sys.argv[1]).resolve()
inputs = json.loads((root / "inputs.json").read_text())
ready = json.loads((root / "readiness.json").read_text())
report = json.loads((root / "browser.json").read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
host = root / "source/host"
area = host / "ui/tests/flow-detail-capabilities"
collector = root / "source/overlay/scripts/sdk-browser-diagnostics.cjs"
if not re.fullmatch(r"[0-9a-f]{40}", inputs.get("overlayCommit", "")):
    raise SystemExit("Invalid overlay source commit")
if ready.get("runId") != inputs.get("transportRunId") or not ready.get("runId"):
    raise SystemExit("Readiness belongs to another transport run")
if ready.get("sourceHash") != sha(area / "serve.mjs"):
    raise SystemExit("Readiness source mismatch")
if inputs.get("runnerSha256") != sha(root / "source/overlay/scripts/run-flow-detail-browser.sh"):
    raise SystemExit("Runner source mismatch")
if not inputs.get("patches") or any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in inputs["patches"].values()):
    raise SystemExit("Missing overlay patch provenance")
for case in report.get("cases", []):
    network = case.get("network", {})
    if network.get("runId") != ready["runId"] or network.get("sourceHash") != ready["sourceHash"] or not network.get("phaseId"):
        raise SystemExit("Case transport identity/source mismatch: " + case.get("name", "unknown"))
    if any(call.get("phaseId") != network["phaseId"] for call in network.get("calls", [])):
        raise SystemExit("Request belongs to another phase")
if inputs.get("sources") != report.get("inputs"):
    raise SystemExit("Startup/final source inputs differ")
for name, expected in inputs["sources"].items():
    candidate = collector if name == "overlay:sdk-browser-diagnostics.cjs" else (area / name).resolve()
    if candidate != collector and not candidate.is_relative_to(host):
        raise SystemExit("Source inventory escapes artifact host tree")
    if sha(candidate) != expected:
        raise SystemExit("Source snapshot hash mismatch: " + name)
regression = ET.parse(root / "evidence-regression.xml").getroot()
cases = list(regression.iter("testcase"))
if len(cases) != 29 or len({case.attrib["name"] for case in cases}) != 29 or any(case.find(tag) is not None for case in cases for tag in ("failure", "error", "skipped")):
    raise SystemExit("The exact 29 diagnostic/checker regressions must pass")
result = subprocess.run(["node", str(area / "check-report.mjs"), str(root / "browser.json"), str(collector)], text=True, capture_output=True, check=True)
summary = json.loads(result.stdout)
print(json.dumps({"overlayCommit": inputs["overlayCommit"], "transportRunId": ready["runId"], "sourceFiles": len(inputs["sources"]), "regressions": len(cases), **summary}))
