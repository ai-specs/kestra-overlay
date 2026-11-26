#!/usr/bin/env python3
"""REQ-0414: require the exact executed XML matrix, never treat missing/skipped as passed."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
EXPECTED = {'io.kestra.webserver.rbac.FlowNamespaceFileReaderV1Test': {'httpOriginMissingOrDifferentAuthenticationFailsBeforeIoAcrossWorker', 'metadataDomainIsOwnerBoundAndAbsentAfterReturn', 'anonymousInactiveMalformedTenantAndPathFailBeforeIo', 'modeAStillAuthenticatesButDoesNotRequirePolicy', 'missingEitherPermissionPerformsZeroFileIo', 'boundsAndDefensiveCopiesAndStreamClose', 'missingFactoryAndMissingEvaluationFailClosedBeforeIo', 'realFactoryUsesPersistedFlowTenantNotLogicalTenant', 'onlyMissingIsEmptyAndIoFailuresRemainErrors', 'cancellingClosesInterruptIgnoringStreamAndRevokesDomain', 'cancellationBeforeOpenReturnsClosesLateStreamExactlyOnce', 'nestedThreadLocalRestoredOnSuccessAndFailureWithoutWorkerLeak', 'flowReadAndExecuteAllowCurrentAndParentWithoutFileGrant'}, 'io.kestra.webserver.rbac.FlowNamespaceFileReaderHttpTest': {'authenticatedModeAOriginSurvivesRealHttpAndWorkerTransfer'}}

def check(directory):
    total = 0
    for classname, expected in EXPECTED.items():
        root = ET.parse(Path(directory) / f'TEST-{classname}.xml').getroot()
        cases = root.findall('testcase')
        names = [case.attrib.get('name', '').removesuffix('()') for case in cases]
        if (root.tag != 'testsuite' or root.attrib.get('name') != classname
            or set(names) != expected or len(names) != len(expected)
            or int(root.attrib.get('tests', '-1')) != len(expected)
            or any(int(root.attrib.get(key, '-1')) != 0 for key in ('failures', 'errors', 'skipped'))
            or any(case.attrib.get('classname') != classname for case in cases)
            or any(case.find(tag) is not None for case in cases for tag in ('failure', 'error', 'skipped'))):
            raise ValueError(f'{classname}: exact executed matrix required, zero failure/error/skip')
        total += len(cases)
    return total

if __name__ == '__main__':
    try:
        print(f'PASS: REQ-0414 {check(sys.argv[1])} exact named cases, zero failure/error/skip')
    except (OSError, ValueError, ET.ParseError) as failure:
        raise SystemExit(f'FAIL: {failure}')
