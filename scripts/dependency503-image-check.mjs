import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const [base,postgres,destination,expected]=process.argv.slice(2),cookies=new Map();
const report={completed:false,checks:[],expectedFaultStatus:Number(expected)};
const sql=query=>execFileSync('docker',['exec',postgres,'psql','-X','-U','kestra','-d','kestra','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
const check=(name,passed,evidence={})=>{report.checks.push({name,passed,...evidence});assert(passed,name);};
const request=async(path,options={})=>{
 const url=new URL(path,base);assert.equal(url.origin,base);
 const response=await fetch(url,{...options,redirect:'manual',headers:{Cookie:[...cookies].map(([name,value])=>name+'='+value).join('; '),...options.headers}});
 for(const header of response.headers.getSetCookie()) {
  const pair=header.split(';')[0],index=pair.indexOf('=');if(index<1)continue;
  if(/max-age=0/i.test(header))cookies.delete(pair.slice(0,index));else cookies.set(pair.slice(0,index),pair.slice(index+1));
 }
 return response;
};
let hidden=false;
try {
 let response=await request('/oauth/login/kestra');
 for(let index=0;index<16&&[301,302,303,307,308].includes(response.status);index++) {
  const target=new URL(response.headers.get('location'),base);assert.equal(target.origin,base);await response.body?.cancel();
  response=target.pathname==='/oidc/login'?await request('/oidc/login',{method:'POST',body:new URLSearchParams({username:'tester',password:'Passw0rd!',from:target.searchParams.get('from')})}):await request(target);
 }
 await response.body?.cancel();check('production-login-created-signed-ui-cookie',cookies.has('JWT'));
 const token=cookies.get('JWT'),[header,payload,signature]=token.split('.');
 const metadata=await(await request('/.well-known/openid-configuration')).json();
 const keys=await(await request(metadata.jwks_uri)).json();
 const jwk=keys.keys.find(key=>key.kid===JSON.parse(Buffer.from(header,'base64url')).kid);
 check('signature-and-real-group-claim',verify('RSA-SHA256',Buffer.from(header+'.'+payload),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(signature,'base64url'))&&JSON.parse(Buffer.from(payload,'base64url')).kestra_application_group_v1?.application_group_id==='probe');
 const baseline=await request('/api/v1/configs');check('production-cookie-business-baseline-200',baseline.status===200,{status:baseline.status});await baseline.body?.cancel();
 const snapshot=()=>createHash('sha256').update(sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) FROM (SELECT username,authentication_version,user_state FROM oidc_user) t")).digest('hex');
 const before=snapshot();
 sql('ALTER TABLE host_dependency503_probe RENAME TO host_dependency503_probe_hidden');hidden=true;
 const fault=await request('/api/v1/configs');const text=await fault.text();
 report.observedFaultStatus=fault.status;
 check('real-cookie-lifecycle-and-typed-chain-fault-status',fault.status===Number(expected),{status:fault.status});
 if(Number(expected)===503) {
  const problem=JSON.parse(text);check('safe-problem503',problem.status===503&&!text.includes('host_dependency503')&&!text.includes('SQLException')&&fault.headers.get('content-type')?.startsWith('application/problem+json'));
 }
 check('same-cookie-and-no-account-side-effects',cookies.get('JWT')===token&&snapshot()===before);
 sql('ALTER TABLE host_dependency503_probe_hidden RENAME TO host_dependency503_probe');hidden=false;
 const recovered=await request('/api/v1/configs');check('restoration-same-cookie-200',recovered.status===200,{status:recovered.status});await recovered.body?.cancel();
 report.completed=true;
} catch(failure) {report.failure=String(failure.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[redacted-jwt]');throw failure;}
finally {
 if(hidden)sql('ALTER TABLE host_dependency503_probe_hidden RENAME TO host_dependency503_probe');
 await writeFile(destination,JSON.stringify(report,null,2)+'\n');
}
