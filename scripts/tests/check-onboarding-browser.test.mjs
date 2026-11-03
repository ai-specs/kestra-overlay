import {test} from 'node:test';import assert from 'node:assert/strict';import {expectedNames,check,checkFinalDiagnostics} from '../check-onboarding-browser.mjs';
const report={completed:true,newNonEnglishCopyVerified:true,productionFirstInstallVerified:false,checks:expectedNames.map(name=>({name,passed:true})),environment:'host-http-test-service-substitute',productionFirstInstall:false};
test('accepts the exact complete ordered 21-case report',()=>assert.equal(check(report),21));
test('rejects missing, reordered, duplicated, failed, and production-overclaim reports',()=>{
 for(const mutate of [r=>r.checks.pop(),r=>r.checks.reverse(),r=>r.checks[0].name='wrong',r=>r.checks[0].passed=false,r=>r.productionFirstInstallVerified=true,r=>r.newNonEnglishCopyVerified=false]){const copy=structuredClone(report);mutate(copy);assert.throws(()=>check(copy));}
});

test('final diagnostics rejects a late error despite an earlier pass verdict',()=>{
 const expectedResponses=[1,2].map(n=>({requestId:'r'+n,documentId:'d'+n,url:'http://localhost/oidc/setup'}));
 const events=expectedResponses.map((row,n)=>({...row,id:'e'+n,kind:'http-error',status:400}));
 const snapshot={events,verdict:{passed:true,expectedResponses}};
 assert.equal(checkFinalDiagnostics(snapshot).passed,true);
 snapshot.events.push({id:'late',kind:'page-error',documentId:'d2',text:'late failure'});
 assert.throws(()=>checkFinalDiagnostics(snapshot));
});
