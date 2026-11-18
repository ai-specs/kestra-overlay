const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {checkReport,names} = require('../check-bookmark-return.cjs');
const hash = name => createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',name))).digest('hex');
const valid = () => {
 const sources=names.map(name=>({name,events:[{id:'event-1',kind:'document'}],documents:[{id:'doc-1',url:'about:blank'}],integrity:[]}));
 const evidence=[{finalUrl:'http://localhost/ui/main/flows',originalCookieConsumed:true},{transport:'HTTP cookie lifecycle check',status:307,expirationCookieCount:1},{finalUrl:'http://localhost/ui/main/dashboards'},{finalUrl:'http://localhost/ui/main/dashboards',originalCookieConsumed:true,destinations:['http://localhost/oidc/login']}];
 return {completed:true,checks:names.map((name,i)=>({name,passed:true,evidence:evidence[i]})),sourceSha256:hash('bookmark-return-browser.cjs'),helperSha256:hash('sdk-browser-diagnostics.cjs'),candidateImage:'sha256:'+'a'.repeat(64),finalInputHashesEqual:true,diagnosticSources:sources,diagnostics:{events:sources.flatMap(source=>source.events.map(event=>({...event,sourceName:source.name,sourceEventId:source.name+':'+event.id})))}};
};
test('exact four checks and current inputs accept local and published digest references',()=>{checkReport(valid());checkReport({...valid(),candidateImage:'ghcr.io/org/image@sha256:'+'a'.repeat(64)});});
test('missing duplicate failed or mismatched-input reports fail closed',()=>{
 for(const change of [x=>x.checks.pop(),x=>x.checks[1]=x.checks[0],x=>x.checks[0].passed=false,x=>x.sourceSha256='b'.repeat(64),x=>x.helperSha256='b'.repeat(64),x=>x.finalInputHashesEqual=false,x=>x.diagnostics.events.push({kind:'diagnostic-integrity-error'}),x=>x.completed=false]){const report=valid();change(report);assert.throws(()=>checkReport(report));}
});

test('empty or forged diagnostic summaries and wrong business evidence are rejected',()=>{
 for(const change of [x=>x.diagnosticSources[0].documents=[],x=>x.diagnosticSources[0].events=[],x=>x.diagnostics.events=[],x=>x.diagnosticSources[0].integrity.push({kind:'diagnostic-integrity-error'}),x=>x.checks[0].evidence.finalUrl='http://localhost/ui/main/dashboards',x=>x.checks[1].evidence.expirationCookieCount=2,x=>x.checks[3].evidence.destinations=['https://attacker.invalid/']]){const report=valid();change(report);assert.throws(()=>checkReport(report));}
});
