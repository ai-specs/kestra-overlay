#!/usr/bin/env python3
from pathlib import Path
import sys,xml.etree.ElementTree as ET
EXPECTED={
 'failedPreparedStateReachesCreateAndNormalCreatedRemainsDefault',
 'nullStateKeepsDefaultCreated',
 'unsupportedPreparedStateFailsBeforeWaiterOrQueue',
 'waiterSubscriptionCancellationDisposesAndDoesNotEmitQueueOrEvent',
}
def check(directory):
 p=Path(directory);root=ET.parse(p/'TEST-io.kestra.core.services.WebhookExecutionStatePropagationTest.xml').getroot();names=[x.attrib.get('name','').removesuffix('()') for x in root.findall('testcase')]
 if set(names)!=EXPECTED or len(names)!=len(EXPECTED) or int(root.attrib.get('tests','0'))!=4 or any(int(root.attrib.get(k,'0')) for k in ('failures','errors','skipped')) or any(case.find(tag) is not None for case in root.findall('testcase') for tag in ('failure','error','skipped')):raise ValueError('exact REQ-0413 matrix requires four named cases with zero failure/error/skip')
 return 4
if __name__=='__main__':
 try: print(f'PASS: REQ-0413 {check(sys.argv[1])} exact named cases, zero failures/errors/skips')
 except (OSError,ValueError,ET.ParseError) as failure: raise SystemExit(f'FAIL: {failure}')
