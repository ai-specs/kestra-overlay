import pathlib
import sys
import xml.etree.ElementTree as ET

results = pathlib.Path(sys.argv[1])
for suite, expected in {
    "TypedAuthorizationContractTest": 3,
    "TypedAuthorizationGateTest": 2,
    "OssRestOperationAdapterTest": 4,
    "TypedQueryDomainsTest": 1,
    "TypedDashboardGateTest": 1,
    "TypedRbacHttpProbeTest": 1,
    "TypedTopologyScopeTest": 1,
    "TypedDashboardQueryTest": 1,
    "AuthorizationInvocationContextTest": 1,
    "ExpandedSubflowAuthorizationTest": 1,
}.items():
    report = ET.parse(results / f"TEST-io.kestra.webserver.rbac.{suite}.xml").getroot()
    if int(report.attrib["tests"]) != expected or any(
        int(report.attrib.get(status, "0")) for status in ("failures", "errors", "skipped")
    ):
        raise SystemExit(f"FAIL: {suite} must execute {expected} tests without failures or skips")
    print(f"PASS: {suite}: {expected} tests executed, no failures or skips")
