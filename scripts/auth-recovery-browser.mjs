import {createRequire} from 'node:module';
import {writeFile,readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import http from 'node:http';
import {createHash} from 'node:crypto';
export function completedFetcher(fetcher) {
 let completed=0, release;
 const ready=new Promise(resolve=>{release=resolve;});
 return async (...args)=>{
  const response=await fetcher(...args);
  await response.clone().arrayBuffer();
  completed++;
  if(completed===2)release();
  await ready;
  return response;
 };
}
export function validateDiagnostics(events, base, status, documentId) {
 const url=base+'/api/v1/main/probe?status='+status;
 const responses=events.filter(event=>event.kind==='response'&&event.status>=400);
 if(responses.length!==2||!['GET','POST'].every(method=>responses.filter(event=>event.url===url&&event.status===status&&event.method===method&&event.resourceType==='fetch').length===1))throw Error('Unexpected HTTP response diagnostics');
 for(const response of responses){
  if(!response.requestId||response.documentId!==documentId||events.filter(event=>event.kind==='requestfinished'&&event.requestId===response.requestId&&event.documentId===documentId).length!==1)throw Error('HTTP request did not finish in its originating document');
 }
 for(const event of events){
  if(event.kind==='requestfailed'||event.kind==='pageerror')throw Error('Unexpected browser failure: '+JSON.stringify(event));
  if(event.kind==='console'&&['error','warning','assert'].includes(event.type)){
   const expected=event.type==='error'&&event.url===url&&event.text===`Failed to load resource: the server responded with a status of ${status} (${status===401?'Unauthorized':status===403?'Forbidden':'Service Unavailable'})`;
   if(!expected)throw Error('Unexpected console diagnostic: '+JSON.stringify(event));
  }
 }
}

export async function run(tree, report) {
const checks=[],errors=[],inputs={},diagnostics=[];
let browser,server,temp,playwrightVersion,finalInputs={},runnerSha256;
let failure;
try {
await mkdir(dirname(report),{recursive:true});
runnerSha256=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const inputFiles=['ui/src/utils/authentication.ts','ui/src/utils/basicAuth.ts','ui/src/utils/csrf.ts','ui/src/override/utils/route.ts','ui/src/extensions/runtime.ts','ui/src/extensions/protocol.ts','ui/src/components/extensions/ExtensionPage.vue'];
const hashes=async()=>Object.fromEntries(await Promise.all(inputFiles.map(async path=>[path,createHash('sha256').update(await readFile(join(tree,path))).digest('hex')])));
for(const path of inputFiles)inputs[path]=createHash('sha256').update(await readFile(join(tree,path))).digest('hex');
const require=createRequire(join(tree,'ui/package.json'));
const {build}=require('esbuild');
const browserRequire=createRequire(import.meta.url);
const playwright=browserRequire('playwright');
playwrightVersion=browserRequire('playwright/package.json').version;
if(playwrightVersion!=='1.61.1')throw Error('Authentication recovery requires Playwright 1.61.1');
const {chromium}=playwright;
temp=await mkdtemp(join(tmpdir(),'host-auth-recovery-'));
const counts={writes:0,reads:0,logins:0};
server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(temp,'bundle.js')));return;}
 if(url.pathname==='/oauth/login/kestra'){counts.logins++;res.end('<h1>Existing OAuth entry</h1>');return;}
 if(url.pathname.startsWith('/api/')){counts[req.method==='POST'?'writes':'reads']++;res.writeHead(Number(url.searchParams.get('status')));res.end();return;}
 res.setHeader('Content-Type','text/html');res.end('<meta name="csrf-token" content="test-csrf"><button>Send request</button><script type="module" src="/bundle.js"></script>');
});
 await build({stdin:{contents:`import {configureOidc,setAuthenticated,recoverUnauthorized} from ${JSON.stringify(join(tree,'ui/src/utils/authentication.ts'))};import {createExtensionRequest} from ${JSON.stringify(join(tree,'ui/src/extensions/runtime.ts'))};configureOidc(true);setAuthenticated(true);const status=Number(new URL(location.href).searchParams.get('status'));const fetcher=(${completedFetcher.toString()})(fetch);const request=createExtensionRequest(new AbortController().signal,'/api/v1/main',fetcher,recoverUnauthorized);document.querySelector('button').addEventListener('click',async()=>{await Promise.allSettled([request('/api/v1/main/probe?status='+status,{method:'POST'}),request('/api/v1/main/probe?status='+status)]);document.body.dataset.done='true'});window.recoveryReady=true;`,resolveDir:tree,loader:'ts'},bundle:true,format:'esm',outfile:join(temp,'bundle.js'),alias:{override:join(tree,'ui/src/override')},define:{'import.meta.env.VITE_APP_API_URL':'""'}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 let documentSequence=0,requestSequence=0;const requests=new WeakMap();
 const source=request=>requests.get(request)??{requestId:null,documentId:null};
 page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())documentSequence++;requests.set(request,{requestId:++requestSequence,documentId:documentSequence});});
 page.on('requestfinished',request=>diagnostics.push({kind:'requestfinished',...source(request),url:request.url(),method:request.method()}));
 page.on('pageerror',error=>diagnostics.push({kind:'pageerror',text:String(error)}));
 page.on('console',message=>diagnostics.push({kind:'console',type:message.type(),text:message.text(),url:message.location().url}));
 page.on('requestfailed',request=>diagnostics.push({kind:'requestfailed',...source(request),url:request.url(),method:request.method(),error:request.failure()?.errorText}));
 page.on('response',response=>diagnostics.push({kind:'response',...source(response.request()),url:response.url(),status:response.status(),method:response.request().method(),resourceType:response.request().resourceType()}));
 for(const status of [403,503,401]){
  counts.writes=counts.reads=counts.logins=0;
  const start=diagnostics.length;
  await page.goto(base+'/?status='+status);const documentId=documentSequence;await page.waitForFunction(()=>window.recoveryReady===true);await page.click('button');
  if(status===401)await page.waitForURL(base+'/oauth/login/kestra');else await page.waitForFunction(()=>document.body.dataset.done==='true');
  if(counts.writes!==1||counts.reads!==1||counts.logins!==(status===401?1:0)||errors.length)throw Error(JSON.stringify({status,counts,errors}));
  const completions=diagnostics.slice(start).filter(event=>event.kind==='response'&&event.status===status).map(event=>event.requestId);
  const deadline=Date.now()+5000;
  while(completions.length===2&&!completions.every(id=>diagnostics.some(event=>event.kind==='requestfinished'&&event.requestId===id))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  validateDiagnostics(diagnostics.slice(start),base,status,documentId);
  checks.push({name:'host-context-request-'+status+'-single-write',status,counts:{...counts},passed:true});
 }
 finalInputs=await hashes();if(JSON.stringify(inputs)!==JSON.stringify(finalInputs))throw Error('Source inputs changed during browser checks');
} catch(error){failure=error;errors.push(String(error));}
finally{
 try{await browser?.close();}catch(error){failure??=error;errors.push(String(error));}
 try{if(server?.listening)await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));}catch(error){failure??=error;errors.push(String(error));}
 try{if(temp)await rm(temp,{recursive:true,force:true});}catch(error){failure??=error;errors.push(String(error));}
 await writeFile(report,JSON.stringify({completed:!failure,environment:'real-chromium-host-http-substitute',productionFirstInstall:false,playwrightVersion,sourceFiles:inputs,finalSourceFiles:finalInputs,runnerSha256,checks,errors,diagnostics,...(failure?{error:String(failure)}:{})},null,2));
}
if(failure)throw failure;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await run(resolve(process.argv[2]),resolve(process.argv[3]));
