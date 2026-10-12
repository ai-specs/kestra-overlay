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
const fixture=`id: mcp-acceptance\nnamespace: overlay.acceptance\ntasks:\n  - id: result\n    type: io.kestra.plugin.core.debug.Return\n    format: verified\ntriggers:\n  - id: mcp\n    type: io.kestra.plugin.core.trigger.McpToolTrigger\n    mcpServer: default\n    toolName: overlay-acceptance\n    title: Acceptance flow\n    toolDescription: Execute acceptance flow\n`;
response=await request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml','X-CSRF-TOKEN':csrf},body:fixture});
check(response.ok,'fixture created through authenticated REST and CSRF');
response=await request('/api/v1/main/mcp-servers',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':csrf},body:JSON.stringify({id:'other-server',serverType:'PRIVATE',authType:'OAUTH',disabled:false})});
check(response.ok,'second real MCP server created through production API');
const resource=`${base}/api/v1/main/mcp/default`;
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
