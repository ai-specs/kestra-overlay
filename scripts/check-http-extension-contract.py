#!/usr/bin/env python3
import sys
from pathlib import Path

def main(root):
    root=Path(root)
    provider=(root/'webserver/src/main/java/io/kestra/webserver/rbac/HttpExtensionRouteProviderV1.java').read_text()
    registry=(root/'webserver/src/main/java/io/kestra/webserver/rbac/HttpExtensionRouteRegistry.java').read_text()
    resource=(root/'webserver/src/main/java/io/kestra/webserver/rbac/TypedAuthorization.java').read_text()
    filter_code=(root/'webserver/src/main/java/io/kestra/webserver/rbac/HttpExtensionRouteFilter.java').read_text()
    test=(root/'webserver/src/test/java/io/kestra/webserver/rbac/HttpExtensionRouteHttpTest.java').read_text()
    required=[('provider version','CONTRACT_VERSION = 1',provider),('provider match','Optional<Target> match',provider),('document metadata','boolean documentReturn',provider),('registry consumer','HttpExtensionRouteProviderV1',registry),('typed resource','EXTENSION_ROUTE',resource),('dispatcher provider','HttpExtensionRouteRegistry',filter_code),('HTTP consumer','realSecurityOrderScopesAndProviderIsolation',test),('bookmark consumer','directBookmarkBootstrapProvidesCsrfWithoutPriorUiVisit',test)]
    consumer=Path(__file__).parent/'tests/classpath-probe/ExecutionContractProbe.java'
    execution=consumer.read_text()
    required += [('execution method subset consumer', 'gate.checked(', execution), ('submission consumer', 'webhook.startExecution(execution)', execution), ('output consumer', 'outputs.getOutputs(execution)', execution)]
    missing=[name for name,needle,body in required if needle not in body]
    if missing: print('FAIL: '+', '.join(missing)); return 1
    print('PASS: HTTP extension V1 provider/resource/registry/dispatcher and HTTP consumers present')
    return 0
if __name__=='__main__': sys.exit(main(sys.argv[1] if len(sys.argv)>1 else '.'))
