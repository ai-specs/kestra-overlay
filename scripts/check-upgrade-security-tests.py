import pathlib
import sys
import xml.etree.ElementTree as ET


REQUIRED = {
    "core": ("io.kestra.core.runners.FlowInputOutputTest", {
        "shouldComputeOnRealSecretValueAndMaskOnlyTheOutputWhenValidatingInputs",
        "shouldComputeOnRealSecretValueOfDependencyWhenValidatingInputs",
        "shouldMaskSecretInputsReferencedByAnotherInputWhenValidatingInputs",
        "shouldMaskSecretsInErrorMessagesWhenValidatingInputs",
        "shouldNotMaskSecretsWhenReadingExecutionInputs",
        "shouldObfuscateSecretsWhenValidatingInputsDeclaredAfterTheirDependent",
    }),
    "webserver": ("io.kestra.webserver.controllers.api.NamespaceFileControllerTest", {
        "createGetFileContent_AddFlowWithNamespaceContainingReplacementCharacters",
    }),
}


def check(directory):
    for module, (suite, expected) in REQUIRED.items():
        report = ET.parse(pathlib.Path(directory) / module / "xml" / f"TEST-{suite}.xml").getroot()
        cases = report.findall("testcase")
        names = [case.attrib.get("name", "").removesuffix("()") for case in cases]
        if (int(report.attrib.get("tests", "0")) != len(expected)
                or len(names) != len(expected) or set(names) != expected
                or any(int(report.attrib.get(status, "0")) for status in ("failures", "errors", "skipped"))
                or any(case.find(status) is not None for case in cases for status in ("failure", "error", "skipped"))):
            raise SystemExit(f"FAIL: {suite} requires all {len(expected)} named cases without failures or skips")
        print(f"PASS: {suite}: {len(expected)} exact named security regressions")


if __name__ == "__main__":
    check(sys.argv[1])
