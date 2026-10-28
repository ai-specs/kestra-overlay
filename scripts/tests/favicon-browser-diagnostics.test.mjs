import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPublicFaviconDiagnostics,redactPublicFaviconEvidence} from '../favicon-browser-diagnostics.mjs';
import {finalizePublicFaviconReport} from '../favicon-browser-cases.mjs';

async function fixture() {
    const session=new EventEmitter();
    session.send=async name=>name==='Page.getFrameTree'?{frameTree:{frame:{id:'top',loaderId:'first',url:'http://probe/oidc/login?code=hidden-code&state=hidden-state'}}}:{};
    session.detach=async()=>{};
    const diagnostics=createPublicFaviconDiagnostics(session,['known-secret']);await diagnostics.attach();
    session.emit('Runtime.executionContextCreated',{context:{id:11,auxData:{frameId:'top'}}});
    const response=(requestId,path,status,method='GET',loaderId='first')=>{
        session.emit('Network.requestWillBeSent',{requestId,frameId:'top',loaderId,type:'Fetch',request:{url:'http://probe'+path,method}});
        session.emit('Network.responseReceived',{requestId,response:{url:'http://probe'+path,status}});
    };
    return {session,diagnostics,response};
}

test('only an exact expected request and its same-document network console are classified',async()=>{
    const {session,diagnostics,response}=await fixture();
    await diagnostics.expectStatus('anonymous','GET','/api/v1/configs',async()=>{response('expected','/api/v1/configs',401);return 401;},[401]);
    session.emit('Log.entryAdded',{entry:{level:'error',source:'network',text:'Failed to load resource: the server responded with a status of 401 (Unauthorized)',url:'http://probe/api/v1/configs',networkRequestId:'expected'}});
    const snapshot=await diagnostics.evidence();
    assert.equal(snapshot.expectedErrorIds.length,2);assert.deepEqual(snapshot.unclassifiedErrorIds,[]);
    assert.deepEqual(snapshot.expectedRequests[0],{name:'anonymous',documentId:'top:first',requestId:'expected',method:'GET',origin:'http://probe',path:'/api/v1/configs',status:401,httpErrorId:'event-2'});
});

test('other 403 responses and application console errors remain unclassified',async()=>{
    const {session,diagnostics,response}=await fixture();
    await diagnostics.expectStatus('zero','GET','/api/v1/configs',async()=>{response('expected','/api/v1/configs',403);return 403;},[403]);
    response('unexpected','/api/v1/main/flows/search',403);
    session.emit('Runtime.consoleAPICalled',{type:'error',executionContextId:11,args:[{value:'application failed'}]});
    const snapshot=await diagnostics.evidence();
    assert.equal(snapshot.unclassifiedErrorIds.length,2);
    assert.equal(snapshot.expectedErrorIds.length,1);
});

test('request failure, page error and unknown context integrity are never hidden',async()=>{
    const {session,diagnostics,response}=await fixture();
    await diagnostics.expectStatus('zero','GET','/api/v1/configs',async()=>{response('expected','/api/v1/configs',403);return 403;},[403]);
    session.emit('Network.loadingFailed',{requestId:'expected',errorText:'net::ERR_ABORTED',canceled:true});
    session.emit('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:11,text:'real failure'}});
    session.emit('Runtime.consoleAPICalled',{type:'error',executionContextId:999,args:[]});
    assert.equal((await diagnostics.evidence()).unclassifiedErrorIds.length,4);
});

test('request method and exact path must match the current immutable document',async()=>{
    const {diagnostics,response}=await fixture();
    await assert.rejects(diagnostics.expectStatus('wrong-method','GET','/favicon.ico',async()=>{response('wrong','/favicon.ico',401,'POST');return 401;},[401]));
    assert.equal((await diagnostics.evidence()).expectedRequests.length,0);
    assert.equal((await diagnostics.evidence()).unclassifiedErrorIds.length,1);
});

test('navigation admits only explicitly enumerated request and document paths',async()=>{
    const {session,diagnostics,response}=await fixture();
    await diagnostics.expectNavigation('zero-login',async()=>{
        session.emit('Page.frameNavigated',{frame:{id:'top',loaderId:'second',url:'http://probe/ui/'}});
        response('known','/api/v1/configs',403,'GET','second');
        response('other','/api/v1/main/flows/search',403,'GET','second');
    },[{method:'GET',path:'/api/v1/configs',status:403,documentPaths:['/ui/']}]);
    const snapshot=await diagnostics.evidence();
    assert.equal(snapshot.expectedRequests[0].documentId,'top:second');
    assert.equal(snapshot.expectedErrorIds.length,1);assert.equal(snapshot.unclassifiedErrorIds.length,1);
});

test('late navigation response is awaited inside its explicit document window, not admitted afterward',async()=>{
    const {session,diagnostics,response}=await fixture();
    await diagnostics.expectNavigation('login-window',async()=>{
        session.emit('Page.frameNavigated',{frame:{id:'top',loaderId:'second',url:'http://probe/ui/'}});
        setTimeout(()=>response('in-window','/ui-extensions/main/manifest',403,'GET','second'),5);
    },[{method:'GET',path:'/ui-extensions/main/manifest',status:403,documentPaths:['/ui/']}]);
    response('outside-window','/ui-extensions/main/manifest',403,'GET','second');
    const snapshot=await diagnostics.evidence();
    assert.equal(snapshot.expectedRequests.length,1);assert.equal(snapshot.expectedRequests[0].requestId,'in-window');
    assert.equal(snapshot.unclassifiedErrorIds.length,1);
});

test('old document with identical manifest path and status is not admitted by a new navigation',async()=>{
    const {session,diagnostics,response}=await fixture();
    session.emit('Page.frameNavigated',{frame:{id:'top',loaderId:'first',url:'http://probe/ui/'}});
    await diagnostics.expectNavigation('new-login',async()=>{
        session.emit('Page.frameNavigated',{frame:{id:'top',loaderId:'second',url:'http://probe/ui/'}});
        response('old-document','/ui-extensions/main/manifest',403,'GET','first');
        response('new-document','/ui-extensions/main/manifest',403,'GET','second');
    },[{method:'GET',path:'/ui-extensions/main/manifest',status:403,documentPaths:['/ui/']}]);
    const snapshot=await diagnostics.evidence();
    assert.equal(snapshot.expectedRequests.length,1);assert.equal(snapshot.expectedRequests[0].documentId,'top:second');
    assert.equal(snapshot.unclassifiedErrorIds.length,1);
});

test('persistable snapshots recursively redact OAuth URLs, JWT and known secrets without losing identities',async()=>{
    const {diagnostics}=await fixture();
    const snapshot=await diagnostics.evidence();
    assert.equal(snapshot.documents[0].url,'http://probe/oidc/login');
    const input={url:'http://probe/callback?code=hidden-code&state=hidden-state&from=%2Fui',requestId:'same-request',documentId:'top:first',method:'GET',path:'/favicon.ico',status:200,
        nested:['known-secret','eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature'],password:'private-password'};
    const redacted=redactPublicFaviconEvidence(input,['known-secret']);
    assert.equal(redacted.requestId,input.requestId);assert.equal(redacted.documentId,input.documentId);
    assert.equal(redacted.url,'http://probe/callback');assert.equal(redacted.nested[0],'[redacted]');assert.equal(redacted.nested[1],'[redacted-jwt]');
    assert.equal(input.password,'private-password');assert.equal(redacted.password,'[redacted]');
    redacted.path='changed';assert.equal(input.path,'/favicon.ico');
});

test('a late final-snapshot error revokes completed and is recorded before failure',async()=>{
    const report={completed:true,checks:[{name:'earlier-snapshot',passed:true}]};
    let saved;
    await assert.rejects(finalizePublicFaviconReport(report,{evidence:async()=>({unclassifiedErrorIds:['late-event'],events:[{id:'late-event',documentId:'old-frame:loader'}]})},async value=>{saved=structuredClone(value);}));
    assert.equal(saved.completed,false);assert.deepEqual(saved.diagnostics.unclassifiedErrorIds,['late-event']);
    assert.equal(saved.checks[0].passed,true);
});

test('cleanup and diagnostics exceptions preserve the partial report and original failure',async()=>{
    const report={completed:false,checks:[{name:'earlier-case',passed:true}],failure:'original-case-failure'};
    let saved;
    await assert.rejects(finalizePublicFaviconReport(report,{evidence:async()=>{throw new Error('snapshot failed');}},async value=>{saved=structuredClone(value);},async()=>{throw new Error('restore failed');}));
    assert.equal(saved.completed,false);assert.equal(saved.failure,'original-case-failure');
    assert.match(saved.cleanupFailure,/restore failed/);assert.match(saved.diagnosticsFailure,/snapshot failed/);
    assert.equal(saved.checks.length,1);
});
