import {createRequire} from 'node:module';
import {writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
const tree=resolve(process.argv[2]), report=resolve(process.argv[3]);
const require=createRequire(join(tree,'ui/package.json'));
const {build}=require('esbuild');
const browserRequire=createRequire(import.meta.url);
const playwright=browserRequire('playwright');
const playwrightVersion=browserRequire('playwright/package.json').version;
if(playwrightVersion!=='1.61.1')throw Error('Authentication recovery requires Playwright 1.61.1');
const {chromium}=playwright;
const temp=await mkdtemp(join(tmpdir(),'host-auth-recovery-'));
const counts={writes:0,reads:0,logins:0};let browser;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(temp,'bundle.js')));return;}
 if(url.pathname==='/oauth/login/kestra'){counts.logins++;res.end('<h1>Existing OAuth entry</h1>');return;}
 if(url.pathname.startsWith('/api/')){counts[req.method==='POST'?'writes':'reads']++;res.writeHead(Number(url.searchParams.get('status')));res.end();return;}
 res.setHeader('Content-Type','text/html');res.end('<meta name="csrf-token" content="test-csrf"><button>Send request</button><script type="module" src="/bundle.js"></script>');
});
const checks=[];const errors=[];
const inputFiles=['ui/src/utils/authentication.ts','ui/src/utils/basicAuth.ts','ui/src/utils/csrf.ts','ui/src/override/utils/route.ts','ui/src/extensions/runtime.ts','ui/src/extensions/protocol.ts','ui/src/components/extensions/ExtensionPage.vue'];
const hashes=async()=>Object.fromEntries(await Promise.all(inputFiles.map(async path=>[path,createHash('sha256').update(await readFile(join(tree,path))).digest('hex')])));
const inputs=await hashes();
try {
 await build({stdin:{contents:`import {configureOidc,setAuthenticated,recoverUnauthorized} from ${JSON.stringify(join(tree,'ui/src/utils/authentication.ts'))};import {createExtensionRequest} from ${JSON.stringify(join(tree,'ui/src/extensions/runtime.ts'))};configureOidc(true);setAuthenticated(true);const status=Number(new URL(location.href).searchParams.get('status'));const request=createExtensionRequest(new AbortController().signal,'/api/v1/main',fetch,recoverUnauthorized);document.querySelector('button').addEventListener('click',async()=>{await Promise.allSettled([request('/api/v1/main/probe?status='+status,{method:'POST'}),request('/api/v1/main/probe?status='+status)]);document.body.dataset.done='true'});window.recoveryReady=true;`,resolveDir:tree,loader:'ts'},bundle:true,format:'esm',outfile:join(temp,'bundle.js'),alias:{override:join(tree,'ui/src/override')},define:{'import.meta.env.VITE_APP_API_URL':'""'}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('pageerror',error=>errors.push(String(error)));
 for(const status of [403,503,401]){
  counts.writes=counts.reads=counts.logins=0;
  await page.goto(base+'/?status='+status);await page.waitForFunction(()=>window.recoveryReady===true);await page.click('button');
  if(status===401)await page.waitForURL(base+'/oauth/login/kestra');else await page.waitForFunction(()=>document.body.dataset.done==='true');
  if(counts.writes!==1||counts.reads!==1||counts.logins!==(status===401?1:0)||errors.length)throw Error(JSON.stringify({status,counts,errors}));
  checks.push({name:'host-context-request-'+status+'-single-write',status,counts:{...counts},passed:true});
 }
 const finalInputs=await hashes();if(JSON.stringify(inputs)!==JSON.stringify(finalInputs))throw Error('Source inputs changed during browser checks');
 await writeFile(report,JSON.stringify({completed:true,environment:'real-chromium-host-http-substitute',productionFirstInstall:false,playwrightVersion,sourceFiles:inputs,finalSourceFiles:finalInputs,runnerSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),checks,errors},null,2));
} catch(error){await writeFile(report,JSON.stringify({completed:false,checks,errors,error:String(error)},null,2));throw error;}
finally{await browser?.close();server.close();await rm(temp,{recursive:true,force:true});}
