import pathlib
import sys
import xml.etree.ElementTree as ET

results = pathlib.Path(sys.argv[1])
for suite, expected in {
    "PublicFaviconHttpTest": 2,
    "PublicFaviconTest": 5,
    "RbacActivationTest": 8,
    "TypedAuthorizationContractTest": 6,
    "TypedAuthorizationGateTest": 2,
    "OssRestOperationAdapterTest": 4,
    "TypedQueryDomainsTest": 1,
    "TypedDashboardGateTest": 1,
    "TypedRbacHttpProbeTest": 1,
    "TypedTopologyScopeTest": 1,
    "TypedDashboardQueryTest": 1,
    "AuthorizationInvocationContextTest": 1,
    "ExpandedSubflowAuthorizationTest": 1,
    "AuthorizationEvaluationTest": 16,
    "AuthorizationInitializationTest": 10,
    "AuthorizationCleanupSchedulingTest": 2,
    "AuthorizationEvaluationRestTest": 2,
    "AuthorizationEvaluationHttpTest": 2,
    "AuthorizationEvaluationApplicationGroupTest": 2,
    "ExtensionResourceAdapterTest": 2,
    "TypedResourceDomainBoundaryTest": 3,
    "QueryDomainFailClosedTest": 4,
}.items():
    report = ET.parse(results / f"TEST-io.kestra.webserver.rbac.{suite}.xml").getroot()
    if int(report.attrib["tests"]) != expected or any(
        int(report.attrib.get(status, "0")) for status in ("failures", "errors", "skipped")
    ):
        raise SystemExit(f"FAIL: {suite} must execute {expected} tests without failures or skips")
    print(f"PASS: {suite}: {expected} tests executed, no failures or skips")

directory = ET.parse(results / "TEST-io.kestra.webserver.oidc.UserDirectoryContractTest.xml").getroot()
if int(directory.attrib["tests"]) != 14 or any(
    int(directory.attrib.get(status, "0")) for status in ("failures", "errors", "skipped")
):
    raise SystemExit("FAIL: UserDirectoryContractTest must execute 14 tests without failures or skips")
print("PASS: UserDirectoryContractTest: 14 tests executed, no failures or skips")

mcp_evaluation = ET.parse(results / "TEST-io.kestra.mcp.McpEvaluationLifecycleTest.xml").getroot()
if int(mcp_evaluation.attrib["tests"]) != 3 or any(
    int(mcp_evaluation.attrib.get(status, "0")) for status in ("failures", "errors", "skipped")
):
    raise SystemExit("FAIL: McpEvaluationLifecycleTest must execute 3 tests without failures or skips")
print("PASS: McpEvaluationLifecycleTest: 3 tests executed, no failures or skips")

dynamic_tools = ET.parse(results / "TEST-io.kestra.mcp.McpDynamicToolListTest.xml").getroot()
if int(dynamic_tools.attrib["tests"]) != 4 or any(
    int(dynamic_tools.attrib.get(status, "0")) for status in ("failures", "errors", "skipped")
):
    raise SystemExit("FAIL: McpDynamicToolListTest must execute 4 tests without failures or skips")
print("PASS: McpDynamicToolListTest: 4 tests executed, no failures or skips")

for suite, expected in {"UiExtensionRegistryTest": 5, "UiExtensionControllerTest": 4, "UiExtensionHttpTest": 1}.items():
    report = ET.parse(results / f"TEST-io.kestra.webserver.ui.{suite}.xml").getroot()
    if int(report.attrib["tests"]) != expected or any(int(report.attrib.get(status, "0")) for status in ("failures", "errors", "skipped")):
        raise SystemExit(f"FAIL: {suite} must execute {expected} tests without failures or skips")
    print(f"PASS: {suite}: {expected} tests executed, no failures or skips")
