"""Release gate: every host application-group probe must execute without skips."""
import pathlib
import sys
import xml.etree.ElementTree as ET

MCP_LIFECYCLE_REQUIRED = {
    "deletedEventReleasesRealSdkListenerAndPendingRequest",
    "postOnlySessionDoesNotProduceRepeatedMissingStreamWarnings",
    "oldGetDisposeCannotRemoveNewListener",
    "getDisconnectKeepsPersistentSessionAndReconnects",
    "activeGetStillReceivesProductionSchedulerPingAndShutdownStopsIt",
    "deletedSessionCloseFailureIsObservable",
    "serviceStopCancelsManagedCloseWithoutBlockingQueue",
    "deletingOneSessionDoesNotCloseAnotherListener",
    "delayedOldGetAfterDeleteCannotResurrectSession",
    "oldAsyncCloseCannotCloseNewOwnerListener",
    "queueCallbackRaceClosesCapturedOldSessionWithoutRemovingNewOwner",
    "deletedSessionTimeoutReleasesActualGetAndPending",
    "stoppedCloseRegistryStillReleasesCapturedGetAndPending",
    "tenantScopedDeleteCannotCloseSameIdListenerInAnotherTenant",
    "wrongSubjectClientOrResourceDeleteCannotCloseActiveOwnerListener",
    "remoteToolCallUsesRealEphemeralHandlerAndPayload",
    "remoteToolsListUsesVisibilityProviderWithoutEphemeralSession",
}

MCP_TRANSPORT_REQUIRED = {
    "shouldRejectRequestWhenServerIsShuttingDown",
    "shouldReturnMethodNotAllowedWhenUnsupportedHttpMethodReceived",
    "shouldRejectRequestWhenRequestHasInvalidResponseType",
    "shouldRejectRequestWhenPostRequestHasEmptyBody",
    "shouldRejectRequestWhenPostRequestHasInvalidBody",
    "shouldReturnSessionIdsWhenInitializeRequestReceived",
    "shouldAcceptRequestWhenNotificationRequestReceived",
    "shouldAcceptRequestWhenPersistentSseConnectionIsOnSeparateInstance",
    "shouldHandleToolCallByEphemeralSessionWhenSseConnectionIsOnSeparateInstance",
    "shouldListVisibleToolsForRemoteSessionWithoutCreatingEphemeralSession",
    "shouldNotifyOnlyLocalSessionsWhenNotifyClientsIsCalled",
    "shouldDeleteSessionAndEmitBroadcastWhenDeleteReceivedForRemoteSseSession",
    "shouldTransferSseOwnershipToThisNodeWhenGetReceivedForRemoteSseSession",
    "shouldRemoveSessionFromLocalStateWhenOwnershipTransferBroadcastReceived",
    "shouldRemoveSessionFromLocalStateWhenDeleteBroadcastReceived",
    "shouldBroadcastCreatedEventWhenSessionInitialized",
    "shouldKeepSessionInLocalStateWhenOwnershipChangedToThisNode",
}

INITIAL_ACCOUNT_REQUIRED = {
    "io.kestra.webserver.oidc.OidcInitialAccountContractTest": 2,
    "io.kestra.webserver.oidc.OidcUiClientScopesTest": 4,
    "io.kestra.webserver.oidc.OidcInitialAccountPageTest": 6,
    "io.kestra.webserver.oidc.OidcInitialAccountPostgresTest": 12,
    "io.kestra.webserver.oidc.OidcInitialAccountHttpTest": 2,
    "io.kestra.webserver.oidc.OidcSetupServiceTest": 13,
    "io.kestra.webserver.oidc.OidcSetupControllerTest": 4,
    "io.kestra.webserver.oidc.OidcInstallationReceiptTest": 2,
}

REQUIRED = {
    "io.kestra.mcp.KestraFluxStreamableServerTransportProviderTest": len(MCP_TRANSPORT_REQUIRED),
    "io.kestra.mcp.McpSessionLifecycleTest": len(MCP_LIFECYCLE_REQUIRED),
    "io.kestra.webserver.oidc.OidcInvalidCookieRecoveryHttpTest": 3,
    "io.kestra.webserver.oidc.OidcLocalMetadataFetcherFactoryTest": 3,
    **INITIAL_ACCOUNT_REQUIRED,
    "io.kestra.webserver.oidc.AuthorizationIdentityClassificationTest": 5,
    "io.kestra.webserver.rbac.AuthorizationUnavailableHttpTest": 2,
    "io.kestra.webserver.rbac.AuthorizationUnavailableBoundaryTest": 2,
    "io.kestra.webserver.rbac.AuthorizationIdentityUnavailablePostgresTest": 1,
    "io.kestra.webserver.oidc.UserDirectoryContractTest": 14,
    "io.kestra.webserver.oidc.ApplicationGroupProtocolProjectionV2Test": 5,
    "io.kestra.webserver.oidc.OidcResourceAudiencePostgresTest": 12,
    "io.kestra.webserver.oidc.OidcResourceAudienceHttpTest": 4,
    "io.kestra.webserver.oidc.OidcAccountDeletionPostgresTest": 4,
    "io.kestra.webserver.oidc.TrustedIdentityBorrowedConnectionTest": 1,
    "io.kestra.webserver.oidc.TrustedIdentityFailureClassificationTest": 6,
    "io.kestra.webserver.oidc.TrustedIdentityLockRecheckPostgresTest": 4,
    "io.kestra.webserver.oidc.OidcPasswordChangePostgresTest": 3,
    "io.kestra.webserver.oidc.OidcPasswordChangeHttpTest": 1,
    "io.kestra.webserver.oidc.OidcClientCredentialMaintenanceTest": 7,
    "io.kestra.webserver.oidc.OidcClientCredentialsHttpTest": 2,
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


def check(results, required=None):
    for suite, expected in (REQUIRED if required is None else required).items():
        path = results / f"TEST-{suite}.xml"
        if not path.is_file():
            raise SystemExit(f"FAIL: missing required report: {suite}")
        report = ET.parse(path).getroot()
        if int(report.attrib.get("tests", "0")) != expected or any(
            int(report.attrib.get(status, "0")) for status in ("failures", "errors", "skipped")
        ):
            raise SystemExit(f"FAIL: {suite} must execute {expected} tests without failures or skips")
        if suite == "io.kestra.mcp.McpSessionLifecycleTest":
            names = [case.get("name", "").removesuffix("()") for case in report.findall("testcase")]
            if len(names) != len(MCP_LIFECYCLE_REQUIRED) or set(names) != MCP_LIFECYCLE_REQUIRED:
                raise SystemExit("FAIL: MCP lifecycle must execute all seventeen exact named cases")
        if suite == "io.kestra.mcp.KestraFluxStreamableServerTransportProviderTest":
            names = [case.get("name", "").removesuffix("()") for case in report.findall("testcase")]
            if len(names) != len(MCP_TRANSPORT_REQUIRED) or set(names) != MCP_TRANSPORT_REQUIRED:
                raise SystemExit("FAIL: MCP transport must execute all seventeen exact named cases")
        print(f"PASS: {suite}: {expected} tests executed, no failures or skips")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[2] == "--initial-account-only":
        check(pathlib.Path(sys.argv[1]), INITIAL_ACCOUNT_REQUIRED)
    elif len(sys.argv) == 2:
        check(pathlib.Path(sys.argv[1]))
    else:
        raise SystemExit("Usage: check-application-project-tests.py RESULTS [--initial-account-only]")
