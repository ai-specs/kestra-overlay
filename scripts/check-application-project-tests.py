"""Release gate: every host application-project probe must execute without skips."""
import pathlib
import sys
import xml.etree.ElementTree as ET

REQUIRED = {
    "io.kestra.mcp.McpCallDiagnosticTest": 1,
    "io.kestra.webserver.oidc.ApplicationDirectoryV1Test": 7,
    "io.kestra.webserver.oidc.TrustedIdentityV1Test": 1,
    "io.kestra.webserver.oidc.ProjectScopeIssuanceTest": 4,
    "io.kestra.webserver.oidc.OidcTrustedIdentityTest": 4,
    "io.kestra.webserver.oidc.OidcProjectTokenIssuanceTest": 3,
    "io.kestra.webserver.oidc.OidcApplicationProjectIntegrationTest": 8,
    "io.kestra.webserver.oidc.projects.DirectoryContextTest": 1,
    "io.kestra.webserver.oidc.projects.JdbcApplicationDirectoryV1PostgresTest": 11,
    "io.kestra.webserver.rbac.AuthorizationEvaluationProjectTest": 2,
    "io.kestra.webserver.rbac.ExtensionResourceAdapterTest": 2,
    "io.kestra.webserver.rbac.TypedResourceDomainBoundaryTest": 3,
    "io.kestra.webserver.rbac.QueryDomainFailClosedTest": 4,
}


def check(results):
    for suite, expected in REQUIRED.items():
        path = results / f"TEST-{suite}.xml"
        if not path.is_file():
            raise SystemExit(f"FAIL: missing required report: {suite}")
        report = ET.parse(path).getroot()
        if int(report.attrib.get("tests", "0")) != expected or any(
            int(report.attrib.get(status, "0")) for status in ("failures", "errors", "skipped")
        ):
            raise SystemExit(f"FAIL: {suite} must execute {expected} tests without failures or skips")
        print(f"PASS: {suite}: {expected} tests executed, no failures or skips")


if __name__ == "__main__":
    check(pathlib.Path(sys.argv[1]))
