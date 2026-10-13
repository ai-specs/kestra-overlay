import pathlib
import sys
import xml.etree.ElementTree as ET

results = pathlib.Path(sys.argv[1])
for suite, expected in {
    "io.kestra.webserver.rbac.NamespaceScopeContractTest": 2,
    "io.kestra.mcp.McpToolScopeTest": 3,
}.items():
    report = ET.parse(results / f"TEST-{suite}.xml").getroot()
    if int(report.attrib["tests"]) != expected or any(
        int(report.attrib.get(status, "0")) for status in ("failures", "errors", "skipped")
    ):
        raise SystemExit(f"FAIL: {suite} must execute {expected} tests without failures or skips")
    print(f"PASS: {suite}: {expected} tests executed, no failures or skips")
