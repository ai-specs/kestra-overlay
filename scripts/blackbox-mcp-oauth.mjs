import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [base, directory] = process.argv.slice(2);
const cookies = new Map();
async function request(path, options = {}, authenticated = true) {
  const response = await fetch(new URL(path, base), {redirect:'manual', ...options,
    headers:{...(authenticated ? {Cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')} : {}), ...options.headers}});
  for (const cookie of response.headers.getSetCookie()) {
    const pair=cookie.split(';')[0]; const separator=pair.indexOf('=');
    cookies.set(pair.slice(0,separator),pair.slice(separator+1));
  }
  return response;
}
function check(condition, label) { if (!condition) throw Error(label); console.log(`PASS ${label}`); }
const form = values => ({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)});
let response=await request('/oauth/login/kestra');
check(response.status===302,'system UI OAuth start');
response=await request(response.headers.get('location'));
check(response.status===307,'system authorize login redirect');
const login=new URL(response.headers.get('location'),base);
const returnTo=login.searchParams.get('from');
response=await request('/oidc/login',form({username:'tester',password:'Passw0rd!',from:returnTo}));
check(response.status===303,'production password login');
response=await request(response.headers.get('location'));
check(response.status===307,'system authorization code');
response=await request(response.headers.get('location'));
check(response.status===303,'system OAuth callback');
response=await request(response.headers.get('location'));
for (let hop=0; hop<5 && [301,302,303,307,308].includes(response.status); hop++) {
  response=await request(response.headers.get('location'));
}
const html=await response.text();
const csrf=html.match(/name="csrf-token"[^>]*content="([^"]+)"/)?.[1]
  || html.match(/content="([^"]+)"[^>]*name="csrf-token"/)?.[1];
check(response.status===200 && Boolean(csrf) && cookies.has('JWT'),'system UI cookie and CSRF available');
if(process.env.MCP_PRISTINE_PROBE==='1') {
  for(const id of ['kestra','default']) {
    const server=await request(`/api/v1/main/mcp-servers/${id}`);
    let value; try { value=await server.json(); } catch { value=null; }
    console.log(`pristine server id=${id} status=${server.status} exists=${value?.id===id} disabled=${value?.id===id?value.disabled:'not-applicable'}`);
    const endpoint=await request(`/api/v1/main/mcp/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},false);
    const metadata=endpoint.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1];
    console.log(`pristine MCP id=${id} status=${endpoint.status} challengeMetadata=${metadata||'absent'}`);
    if(metadata) {
      const result=await request(metadata,{},false);
      let document;try{document=await result.json();}catch{document=null;}
      console.log(`pristine metadata id=${id} status=${result.status} contentType=${result.headers.get('content-type')} resourceExact=${document?.resource===`${base}/api/v1/main/mcp/${id}`}`);
    }
  }
  process.exit(0);
}
const fixture=`id: mcp-acceptance\nnamespace: overlay.acceptance\ntasks:\n  - id: result\n    type: io.kestra.plugin.core.debug.Return\n    format: verified\ntriggers:\n  - id: mcp\n    type: io.kestra.plugin.core.trigger.McpToolTrigger\n    mcpServer: default\n    toolName: overlay-acceptance\n    title: Acceptance flow\n    toolDescription: Execute acceptance flow\n`;
response=await request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml','X-CSRF-TOKEN':csrf},body:fixture});
check(response.ok,'fixture created through authenticated REST and CSRF');
response=await request('/api/v1/main/mcp-servers',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':csrf},body:JSON.stringify({id:'other-server',serverType:'PRIVATE',authType:'OAUTH',disabled:false})});
check(response.ok,'second real MCP server created through production API');
const discoveryChallenge=await request('/api/v1/main/mcp/default',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},false);
const discoveredMetadata=discoveryChallenge.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1];
check(discoveryChallenge.status===401 && Boolean(discoveredMetadata),'MCP challenge discovery');
const discoveredResponse=await request(discoveredMetadata,{},false);
check(discoveredResponse.status===200,'protected resource metadata discovery');
const resource=(await discoveredResponse.json()).resource;
check(resource===`${base}/api/v1/main/mcp/default`,'discovered resource is exact canonical server URL');
const diagnosticRegistration=await request('/oidc/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['http://127.0.0.1:19086/callback'],token_endpoint_auth_method:'none'})},false);
check(diagnosticRegistration.status===201,'resource diagnostic registration');
const diagnosticClient=await diagnosticRegistration.json();
for(const [candidate,expected] of [[resource,200],[`${base}/api/v1/main/mcp/other-server`,200],[`${resource}/`,400],[`${base}/api/v1/main/mcp/%64efault`,400],[`${base.replace('localhost','127.0.0.1')}/api/v1/main/mcp/default`,400],[`${base}/api/v1/main/mcp/missing`,400]]) {
  const query=new URLSearchParams({client_id:diagnosticClient.client_id,redirect_uri:'http://127.0.0.1:19086/callback',response_type:'code',scope:'openid',code_challenge:'a'.repeat(43),code_challenge_method:'S256',resource:candidate});
  const result=await request(`/oidc/authorize?${query}`);
  console.log(`resource authorize ${candidate} status=${result.status}`);
  check(result.status===expected,'resource candidate regression');
}
const challenge=await request('/api/v1/main/mcp/default',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},false);
const metadataUrl=challenge.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1];
check(Boolean(metadataUrl),'challenge resource metadata URL present');
const fullMetadata=await request(metadataUrl,{},false);
console.log(`metadata full ${metadataUrl} status=${fullMetadata.status}`);
check(fullMetadata.status===200 && (await fullMetadata.json()).resource===resource,'challenge metadata canonical resource');
const bareMetadata=await request('/.well-known/oauth-protected-resource',{},false);
console.log(`metadata bare ${base}/.well-known/oauth-protected-resource status=${bareMetadata.status} contentType=${bareMetadata.headers.get('content-type')}`);
async function authorize(scope, filename) {
  let result=await request('/oidc/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['http://127.0.0.1:19086/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],scope,client_name:'MCP CI acceptance'})},false);
  check(result.status===201,'public DCR pending');
  const registration=await result.json();
  const verifier='v'.repeat(64);
  const query=new URLSearchParams({client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],response_type:'code',scope,state:'ci-state',nonce:'ci-nonce',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource});
  result=await request(`/oidc/authorize?${query}`);
  const page=await result.text();
  const interaction=page.match(/name="interaction" value="([^"]+)"/)?.[1];
  check(result.status===200 && Boolean(interaction),'user consent required');
  const choices=Object.fromEntries(scope.split(' ').map(value=>[`scope-${value}`,'yes']));
  result=await request('/oidc/consent',{...form({interaction,decision:'approve',...choices}),headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'}});
  check(result.status===303,'consent binds owner');
  const callback=new URL(result.headers.get('location'));
  check(callback.searchParams.get('state')==='ci-state','state preserved');
  result=await request('/oidc/token',form({grant_type:'authorization_code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],code:callback.searchParams.get('code'),code_verifier:verifier,resource}),false);
  check(result.status===200,'S256 resource-bound token');
  const tokens=await result.json();
  const claims=JSON.parse(Buffer.from(tokens.access_token.split('.')[1],'base64url').toString('utf8'));
  const audiences=typeof claims.aud==='string'?[claims.aud]:claims.aud;
  console.log(`access audience representation=${typeof claims.aud==='string'?'string':'array'} exact=${Array.isArray(audiences)&&audiences.length===1&&audiences[0]===resource}`);
  check(Array.isArray(audiences) && audiences.length===1 && audiences[0]===resource,'access token audience exactly matches discovered resource');
  writeFileSync(`${directory}/${filename}`,JSON.stringify(tokens),{mode:0o600});
  writeFileSync(`${directory}/${filename}.client`,JSON.stringify({client_id:registration.client_id,resource}),{mode:0o600});
  return tokens;
}
const full=await authorize('openid mcp:flows:read mcp:executions:write','full.json');
await authorize('openid mcp:flows:read mcp:executions:write','rbac.json');
await authorize('openid mcp:flows:read','read.json');
const initialize=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'negative',version:'1'}}});
for (const headers of [{Authorization:'Basic dGVzdDp0ZXN0'},{Cookie:'oidc_session=invalid; JWT=invalid'},{Authorization:`Bearer ${full.id_token}`}]) {
  response=await request('/api/v1/main/mcp/default',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body:initialize},false);
  check(response.status===401 && response.headers.get('www-authenticate')?.includes('resource_metadata='),'Basic/cookie/ID token rejected');
}
console.log('PASS HTTP OAuth fixture ready for real SDK');
writeFileSync(`${directory}/owner-cookies.json`,JSON.stringify([...cookies]),{mode:0o600});
