import {readFileSync} from 'node:fs';
const [base,directory]=process.argv.slice(2);
const client=JSON.parse(readFileSync(`${directory}/full.json.client`,'utf8'));
const token=JSON.parse(readFileSync(`${directory}/full.json`,'utf8'));
const ownerCookie=JSON.parse(readFileSync(`${directory}/owner-cookies.json`,'utf8')).map(([key,value])=>`${key}=${value}`).join('; ');
const check=(condition,label)=>{if(!condition)throw Error(label);console.log(`PASS ${label}`);};
const login=await fetch(`${base}/oidc/login`,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'second-user',password:'SecondPass123!',from:'/ui/'})});
check(login.status===303,'second production-service user login');
const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
let response=await fetch(`${base}/oidc/clients/${client.client_id}`,{headers:{Cookie:cookie}});
check(response.status===404,'B cannot view A client');
response=await fetch(`${base}/oidc/clients`,{headers:{Cookie:cookie}});
check(response.status===200 && (await response.json()).clients.length===0,'B list excludes A clients');
const ownerDetail=await fetch(`${base}/oidc/clients/${client.client_id}`,{headers:{Cookie:ownerCookie}});
const interaction=(await ownerDetail.json()).interaction;
for(const action of ['revoke','delete']) {
  response=await fetch(`${base}/oidc/clients/${client.client_id}/revoke`,{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action,interaction})});
  check([403,404].includes(response.status),`B cannot ${action} A client using A interaction`);
}
response=await fetch(`${base}/oidc/clients/${client.client_id}`,{headers:{Cookie:ownerCookie}});
check(response.status===200 && (await response.json()).active===true,'A client remains active after B mutations');
const query=new URLSearchParams({client_id:client.client_id,redirect_uri:'http://127.0.0.1:19086/callback',response_type:'code',scope:'openid',code_challenge:'a'.repeat(43),code_challenge_method:'S256',resource:client.resource});
response=await fetch(`${base}/oidc/authorize?${query}`,{headers:{Cookie:cookie},redirect:'manual'});
check(response.status===400,'B cannot authorize A client');
response=await fetch(`${base}/api/v1/main/mcp/other-server`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:'{}'});
check(response.status===401,'A token rejected for another resource');
