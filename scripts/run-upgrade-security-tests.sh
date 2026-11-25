#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TREE="${1:?upstream source tree required}"
OUTPUT="${2:?evidence directory required}"
mkdir -p "$OUTPUT"
export UPGRADE_SECURITY_OUTPUT="$(cd "$OUTPUT" && pwd)"
cat > "$UPGRADE_SECURITY_OUTPUT/tests.init.gradle" <<'GRADLE'
allprojects {
    afterEvaluate {
        if (path == ':core' || path == ':webserver') {
            tasks.named('test', Test).configure {
                outputs.upToDateWhen { false }
                outputs.doNotCacheIf('Exact upstream security regressions must execute') { true }
                def output = System.getenv('UPGRADE_SECURITY_OUTPUT') + '/' + project.name
                reports.junitXml.outputLocation = file(output + '/xml')
                reports.html.outputLocation = file(output + '/html')
                binaryResultsDirectory = file(output + '/binary')
                if (project.path == ':webserver') {
                    systemProperty 'micronaut.security.enabled', 'true'
                    systemProperty 'micronaut.security.filter.enabled', 'false'
                }
            }
        }
    }
}
GRADLE
(
    cd "$TREE"
    ./gradlew --init-script "$UPGRADE_SECURITY_OUTPUT/tests.init.gradle" :core:test \
        --tests 'io.kestra.core.runners.FlowInputOutputTest.shouldComputeOnRealSecretValueAndMaskOnlyTheOutputWhenValidatingInputs' \
        --tests 'io.kestra.core.runners.FlowInputOutputTest.shouldComputeOnRealSecretValueOfDependencyWhenValidatingInputs' \
        --tests 'io.kestra.core.runners.FlowInputOutputTest.shouldMaskSecretInputsReferencedByAnotherInputWhenValidatingInputs' \
        --tests 'io.kestra.core.runners.FlowInputOutputTest.shouldMaskSecretsInErrorMessagesWhenValidatingInputs' \
        --tests 'io.kestra.core.runners.FlowInputOutputTest.shouldNotMaskSecretsWhenReadingExecutionInputs' \
        --tests 'io.kestra.core.runners.FlowInputOutputTest.shouldObfuscateSecretsWhenValidatingInputsDeclaredAfterTheirDependent' \
        --console=plain
    ./gradlew --init-script "$UPGRADE_SECURITY_OUTPUT/tests.init.gradle" :webserver:test \
        --tests 'io.kestra.webserver.controllers.api.NamespaceFileControllerTest.createGetFileContent_AddFlowWithNamespaceContainingReplacementCharacters' \
        --console=plain
)
python3 "$REPO/scripts/check-upgrade-security-tests.py" "$UPGRADE_SECURITY_OUTPUT"
