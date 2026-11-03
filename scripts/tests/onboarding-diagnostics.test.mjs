import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDiagnostics} from '../onboarding-diagnostics.mjs';
const expected=[1,2].map(index=>({requestId:'request-'+index,documentId:'document-'+index,url:'http://localhost/oidc/setup'}));
const events=expected.map((row,index)=>({id:'event-'+index,kind:'http-error',status:400,...row}));
test('only exact two invalid-form responses are accepted',()=>assert.equal(validateDiagnostics({events},expected).passed,true));
test('unknown console/page/request/network/source failures are rejected',()=>{
 for(const kind of ['console-error','page-error','request-failed','http-error','diagnostic-integrity-error'])assert.throws(()=>validateDiagnostics({events:[...events,{id:'bad',kind,documentId:'unknown',status:400}]},expected));
});
test('same URL on another document or request is not an allowed400',()=>{
 for(const field of ['documentId','requestId'])assert.throws(()=>validateDiagnostics({events:events.map((row,index)=>index?row:{...row,[field]:'other'})},expected));
});
test('expected network console must bind exact request document and400 text',()=>{
 const row={id:'console',kind:'console-error',channel:'Log.entryAdded',source:'network',networkRequestId:expected[0].requestId,documentId:expected[0].documentId,url:expected[0].url,text:'Failed to load resource: the server responded with a status of 400 (Bad Request)'};
 assert.equal(validateDiagnostics({events:[...events,row]},expected).passed,true);
 for(const field of ['documentId','networkRequestId','text'])assert.throws(()=>validateDiagnostics({events:[...events,{...row,[field]:'other'}]},expected));
});
