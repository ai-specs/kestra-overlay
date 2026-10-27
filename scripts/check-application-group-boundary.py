"""Reject host application-group business storage and missing protocol activation before release."""
from pathlib import Path
import sys
import zipfile


BUSINESS_TABLES = ('oidc_application_group_', 'oidc_project_', 'rbac_application_group_', 'rbac_application_scope_declaration')
LEGACY_TYPES = ('io/kestra/webserver/oidc/ApplicationDirectoryV1',
                'io/kestra/webserver/oidc/ApplicationGroupManagementV1',
                'io/kestra/webserver/oidc/applicationgroups/')


def check(root, artifact=None):
    main = root / 'webserver/src/main'
    package = main / 'java/io/kestra/webserver/oidc'
    failures = []
    forbidden = [
        'ApplicationDirectoryV1.java',
        'ApplicationGroupManagementV1.java',
        'applicationgroups/ApplicationDirectoryBootstrap.java',
        'applicationgroups/ApplicationDirectoryCommand.java',
        'applicationgroups/DirectorySnapshotCodec.java',
        'applicationgroups/JdbcApplicationDirectoryV1.java',
        'applicationgroups/ApplicationGroupDirectoryState.java',
        'applicationgroups/V1ApplicationDirectoryMigration.java',
    ]
    for name in forbidden:
        if (package / name).exists():
            failures.append('superseded host business contract or implementation: ' + name)
    for name in ['ApplicationGroupProtocolProjectionV1.java', 'ApplicationGroupProtocolProjectionV2.java',
                 'OidcProtocolStateV1.java', 'OidcProtocolState.java', 'IdentityLifecycleGuardV1.java',
                 'IdentityLifecycleParticipantV1.java', 'TrustedIdentityV2.java', 'UserDirectoryV2.java',
                 'ClientCredentialsV1.java']:
        if not (package / name).is_file():
            failures.append('missing public protocol mechanism: ' + name)
    for file in main.rglob('*'):
        if file.is_file() and file.suffix in {'.java', '.sql'}:
            text = file.read_text()
            if any(table in text for table in BUSINESS_TABLES):
                failures.append('host application-group business table reference: ' + str(file.relative_to(root)))
            if file.suffix == '.java' and any(symbol in text for symbol in ['ApplicationDirectoryV1', 'ApplicationGroupManagementV1', 'oidc.applicationgroups.']):
                failures.append('superseded business type reference: ' + str(file.relative_to(root)))
    consumers = {
        'services/OidcTokenService.java': ['ApplicationGroupProtocolProjectionV1', 'OidcProtocolStateV1'],
        'services/OidcTrustedIdentity.java': ['ApplicationGroupProtocolProjectionV1', 'OidcProtocolStateV1'],
        'services/OidcUserDirectory.java': ['IdentityLifecycleGuardV1', 'OidcProtocolStateV1'],
        'services/OidcOwnershipService.java': ['IdentityLifecycleGuardV1', 'OidcProtocolStateV1'],
        'services/OidcApplicationGroupProjection.java': ['ApplicationGroupProtocolProjectionV2', 'audience_contract_version'],
    }
    for name, required in consumers.items():
        file = package / name
        if not file.is_file():
            failures.append('missing protocol consumer: ' + name)
            continue
        text = file.read_text()
        for symbol in required:
            if symbol not in text:
                failures.append(name + ' has not activated ' + symbol)
        if any(symbol in text for symbol in ['JdbcApplicationDirectoryV1', 'ApplicationGroupDirectoryState', '.firstPartyUi()']):
            failures.append('superseded business directory dependency: ' + name)
    if artifact is not None:
        with zipfile.ZipFile(artifact) as archive:
            entries = archive.namelist()
            required = ['io/kestra/webserver/oidc/' + name + '.class' for name in
                        ['ApplicationGroupProtocolProjectionV1', 'ApplicationGroupProtocolProjectionV1$Request',
                         'ApplicationGroupProtocolProjectionV1$Projection', 'ApplicationGroupProtocolProjectionV1$Result',
                         'ApplicationGroupProtocolProjectionV2', 'ApplicationGroupProtocolProjectionV2$Projection',
                         'ApplicationGroupProtocolProjectionV2$Result', 'IdentityLifecycleParticipantV1',
                         'IdentityLifecycleParticipantV1$Kind', 'IdentityLifecycleParticipantV1$Change',
                         'TrustedIdentityV2', 'UserDirectoryV2', 'UserDirectoryV2$TemporaryUser',
                         'ClientCredentialsV1', 'ClientCredentialsV1$CredentialStatus', 'ClientCredentialsV1$IssuedCredential',
                         'ClientCredentialsV1$ClientType', 'ClientCredentialsV1$RotationMode',
                         'ClientCredentialsV1$Failure', 'ClientCredentialsV1$CredentialException',
                         'OidcProtocolStateV1', 'OidcProtocolStateV1$PendingClient', 'OidcProtocolState', 'IdentityLifecycleGuardV1']]
            for name in required:
                if entries.count(name) != 1:
                    failures.append('host artifact must contain exactly one public protocol class: ' + name)
            for name in entries:
                if any(symbol in name.replace('.', '/') for symbol in LEGACY_TYPES):
                    failures.append('host artifact retains superseded business type: ' + name)
                if name.startswith('io/kestra/webserver/oidc/') and name.endswith('.class'):
                    content = archive.read(name)
                    if any(symbol.encode() in content for symbol in LEGACY_TYPES + BUSINESS_TABLES):
                        failures.append('host bytecode retains a business dependency: ' + name)
    if failures:
        raise SystemExit('\n'.join('FAIL: ' + failure for failure in failures))
    print('PASS: host application-group ownership boundary and protocol activation structure' + (' and executable artifact' if artifact is not None else ''))


if __name__ == '__main__':
    check(Path(sys.argv[1]),Path(sys.argv[2]) if len(sys.argv) > 2 else None)
