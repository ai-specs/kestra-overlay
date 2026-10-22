"""Release gate: every host application-group probe must execute without skips."""
import pathlib
import sys
import xml.etree.ElementTree as ET

REQUIRED = {
    "io.kestra.webserver.ui.UiExtensionEntryHttpTest": 4,
    "io.kestra.webserver.rbac.ExtensionDiscoveryRouteTest": 1,
    "io.kestra.webserver.oidc.OauthAuthorizationErrorRoutingTest": 6,
    "io.kestra.mcp.McpCallDiagnosticTest": 1,
    "io.kestra.mcp.McpAsyncIdentityContextTest": 5,
    "io.kestra.webserver.oidc.TrustedIdentityV1Test": 1,
    "io.kestra.webserver.oidc.ApplicationGroupScopeIssuanceTest": 4,
    "io.kestra.webserver.oidc.ApplicationGroupProtocolProjectionV1Test": 5,
    "io.kestra.webserver.oidc.OidcProtocolStateTest": 8,
    "io.kestra.webserver.oidc.OidcAccountLifecycleGuardTest": 6,
    "io.kestra.webserver.oidc.OidcAccountLifecycleGuardPostgresTest": 4,
    "io.kestra.webserver.oidc.OidcClientLifecycleGuardTest": 7,
    "io.kestra.webserver.oidc.OidcClientLifecycleGuardPostgresTest": 3,
    "io.kestra.webserver.oidc.OidcTrustedIdentityTest": 13,
    "io.kestra.webserver.oidc.OidcProtocolProjectionAuthorizationTest": 12,
    "io.kestra.webserver.oidc.OidcPendingClientConsentTest": 5,
    "io.kestra.webserver.oidc.OidcApplicationGroupTokenIssuanceTest": 4,
    "io.kestra.webserver.oidc.OidcApplicationGroupIntegrationTest": 9,
    "io.kestra.webserver.rbac.AuthorizationEvaluationApplicationGroupTest": 2,
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
