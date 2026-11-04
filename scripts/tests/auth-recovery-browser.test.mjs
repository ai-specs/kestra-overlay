import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run,validateDiagnostics,completedFetcher} from '../auth-recovery-browser.mjs';

const base='http://127.0.0.1:12345';
const responses=status=>['GET','POST'].map((method,index)=>({requestId:index+1,documentId:1,kind:'response',url:base+'/api/v1/main/probe?status='+status,status,method,resourceType:'fetch'})).flatMap(event=>[event,{kind:'requestfinished',requestId:event.requestId,documentId:1}]);

test('accepts only the exact expected status, source URL, method and fetch responses',()=>{
 for(const status of [403,503,401]){
  validateDiagnostics(responses(status),base,status,1);
  for(const change of [{url:base+'/unrelated'},{method:'DELETE'},{status:500},{resourceType:'document'}]){
   const events=responses(status);Object.assign(events[0],change);
   assert.throws(()=>validateDiagnostics(events,base,status,1));
  }
  assert.throws(()=>validateDiagnostics(responses(status).slice(2),base,status,1));
  assert.throws(()=>validateDiagnostics([...responses(status),responses(status)[0]],base,status,1));
 }
});

test('rejects console errors without exact expected HTTP source and all browser failures',()=>{
 const events=responses(401);
 const expected={kind:'console',type:'error',url:events[0].url,text:'Failed to load resource: the server responded with a status of 401 (Unauthorized)'};
 validateDiagnostics([...events,expected],base,401,1);
 for(const event of [{...expected,url:''},{...expected,url:base+'/other'},{...expected,text:'Unexpected exception'},
  {...expected,type:'warning'},{kind:'pageerror',text:'crash'},{kind:'requestfailed',url:events[0].url,error:'net::ERR_FAILED'}]){
  assert.throws(()=>validateDiagnostics([...events,event],base,401,1));
 }
});

test('rejects unfinished responses, wrong document completion and explicit aborts',()=>{
 const events=responses(403);
 assert.throws(()=>validateDiagnostics(events.filter(event=>event.kind!=='requestfinished'),base,403,1));
 assert.throws(()=>validateDiagnostics(events.map(event=>event.kind==='requestfinished'?{...event,documentId:2}:event),base,403,1));
 assert.throws(()=>validateDiagnostics([...events,{kind:'requestfailed',requestId:1,documentId:1,error:'net::ERR_ABORTED'}],base,403,1));
});

test('fetch wrapper finishes both bodies before releasing responses and preserves original bodies',async()=>{
 let finish;
 const slow=new Response(new ReadableStream({start(controller){finish=()=>{controller.enqueue(new TextEncoder().encode('slow'));controller.close();};}}));
 const fast=new Response('fast');let calls=0,released=0;
 const fetcher=completedFetcher(async()=>++calls===1?fast:slow);
 const first=fetcher('/first').then(response=>{released++;return response;});
 const second=fetcher('/second').then(response=>{released++;return response;});
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(released,0);
 finish();
 const results=await Promise.all([first,second]);
 assert.equal(results[0],fast);assert.equal(results[1],slow);
 assert.equal(fast.bodyUsed,false);assert.equal(slow.bodyUsed,false);
 assert.equal(await fast.text(),'fast');assert.equal(await slow.text(),'slow');
});

test('startup input failure writes a report retaining checks, input hashes and errors',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'auth-recovery-report-test-'));
 const report=join(directory,'reports','failure.json');
 try{
  await assert.rejects(run(join(directory,'missing-tree'),report));
  const result=JSON.parse(await readFile(report,'utf8'));
  assert.equal(result.completed,false);
  assert.deepEqual(result.checks,[]);
  assert.deepEqual(result.sourceFiles,{});
  assert.deepEqual(result.finalSourceFiles,{});
  assert.ok(result.errors.length);
  assert.equal(typeof result.error,'string');
  assert.match(result.runnerSha256,/^[a-f0-9]{64}$/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('partial input read failure preserves already measured source hashes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'auth-recovery-partial-test-'));
 const report=join(directory,'failure.json');
 try{
  await mkdir(join(directory,'ui/src/utils'),{recursive:true});
  await writeFile(join(directory,'ui/src/utils/authentication.ts'),'export const probe=true;');
  await assert.rejects(run(directory,report));
  const result=JSON.parse(await readFile(report,'utf8'));
  assert.equal(result.completed,false);
  assert.deepEqual(Object.keys(result.sourceFiles),['ui/src/utils/authentication.ts']);
  assert.match(result.sourceFiles['ui/src/utils/authentication.ts'],/^[a-f0-9]{64}$/);
  assert.ok(result.errors.some(error=>error.includes('basicAuth.ts')));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('missing dependency preserves all seven measured inputs in the failure report',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'auth-recovery-dependency-test-'));
 const report=join(directory,'failure.json');
 const files=['utils/authentication.ts','utils/basicAuth.ts','utils/csrf.ts','override/utils/route.ts','extensions/runtime.ts','extensions/protocol.ts','components/extensions/ExtensionPage.vue'];
 try{
  for(const file of files){const target=join(directory,'ui/src',file);await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});await writeFile(target,'test input');}
  await assert.rejects(run(directory,report));
  const result=JSON.parse(await readFile(report,'utf8'));
  assert.equal(result.completed,false);
  assert.equal(Object.keys(result.sourceFiles).length,7);
  assert.ok(result.errors.some(error=>error.includes('esbuild')));
  assert.deepEqual(result.checks,[]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
