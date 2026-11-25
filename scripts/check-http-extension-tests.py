#!/usr/bin/env python3
"""Require all named REQ-0410 test cases; missing, duplicate, failed or skipped cases fail."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

EXPECTED = {'HttpExtensionRouteFilterTest': ['selectedTargetIsUsedWithoutRematchingAfterHandler()', 'anonymousExtensionRequestIsRejectedWithoutHandler()', 'ordinaryDottedFlowIdsAreAllowedButTraversalSegmentsAreRejected()', 'modeBRequiresTypedAndEvaluationSwitches()', 'revokedLifecyclePrecedesDispatcherInBothModes()', 'overlappingProvidersFailClosedWithoutHandler()', 'zeroMatchPreservesUnknownResult()', 'nativeAndUnmatchedErrorsAreNotRewritten()', 'nativeAndReservedPathsProceedBeforeProviders()', 'standardHttpStatusExceptionsKeepCodeWithoutLeakingDetailsAndUnknownIs503()', 'duplicateAndFaultyMetadataNeverStartHandlersOrBreakNative()', 'actualStaticResolverWinsBeforeCatchAllProvider()', 'noProviderPreservesUnknownResultAndMissingCsrf()', 'snapshotClosesExactlyOnceOnCompletionErrorAndCancellation()', 'allReservedPrefixesAndMalformedRawPathsNeverMatch()', 'modeAStillRequiresCsrfComponentForWriteButNotRead()'], 'HttpExtensionRouteHttpTest': ['realHttpRevokedSessionStopsBeforeDispatcher()', 'invalidDocumentRecoversAndApiDoesNotRedirect()', 'deniedDocumentUsesExistingExitPageAndApiKeeps403()', 'realSecurityOrderScopesAndProviderIsolation()', 'directBookmarkBootstrapProvidesCsrfWithoutPriorUiVisit()', 'actualNativeAliasRouteDoesNotInvokeProviderEvenOnNativeDenial()'], 'HttpExtensionBookmarkTest': ['onlyUniqueRegisteredDocumentReturnsAndRoundTrips()']}

EXPECTED['io.kestra.webserver.oidc.SessionAuthorizationFailureTest'] = [
    'groupProjectionSqlFailureIsUnavailableWithoutCommit()',
    'healthyGroupSessionCommitsWithoutChangingItsIdentity()',
    'healthyStandardZeroGrantSessionStillWorks()',
    'standardSessionCannotGainAnActivatedGroupWithoutItsSignedClaim()',
    'groupRevocationRemainsDeniedRatherThanUnavailable()',
    'standardIdentityConnectionSqlFailureIsUnavailable()',
    'standardIdentityProjectionSqlFailureIsUnavailableWithoutCommit()',
    'standardIdentityInvalidAccountRemainsDenied()',
    'lifecycleKeepsUnavailableCookieAndReturnsSafe503BeforeDownstream()',
    'lifecycleUnknownFailureRetainsApi401AndDocumentLogout()',
]

def report_path(directory, suite):
    qualified = suite if '.' in suite else 'io.kestra.webserver.rbac.' + suite
    return Path(directory) / f'TEST-{qualified}.xml'

def check(directory):
    directory=Path(directory)
    total=0
    for suite,names in EXPECTED.items():
        root=ET.parse(report_path(directory, suite)).getroot()
        cases=root.findall('testcase')
        actual=[case.attrib.get('name') for case in cases]
        if len(actual)!=len(names) or set(actual)!=set(names):
            raise ValueError(f"{suite}: exact named matrix missing or duplicated")
        if any(int(root.attrib.get(key,'0')) for key in ['failures','errors','skipped']) or any(case.find(tag) is not None for case in cases for tag in ['failure','error','skipped']):
            raise ValueError(f"{suite}: failures/errors/skips are forbidden")
        if int(root.attrib.get('tests','0'))!=len(names): raise ValueError(f"{suite}: count mismatch")
        total+=len(names)
    return total

if __name__=='__main__':
    try: print(f"PASS: REQ-0410/0412 {check(sys.argv[1])} exact named cases, zero failures/errors/skips")
    except (OSError,ValueError,ET.ParseError) as failure: raise SystemExit(f"FAIL: {failure}")
