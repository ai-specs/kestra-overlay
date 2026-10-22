import assert from 'node:assert/strict'
import {createHash,createPublicKey,randomBytes,verify} from 'node:crypto'
const base=process.argv[2],cookies=new Map()
assert.equal(new URL(base).origin,base)
const request=async(path,options={})=>{
  const url=new URL(path,base);assert.equal(url.origin,base)
  const response=await fetch(url,{...options,redirect:'manual',headers:{Cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),...options.headers}})
  for(const cookie of response.headers.getSetCookie()) {
    const pair=cookie.split(';')[0],index=pair.indexOf('=');if(index<1)continue
    const key=pair.slice(0,index),value=pair.slice(index+1)
    if(value&&!/max-age=0/i.test(cookie))cookies.set(key,value);else cookies.delete(key)
  }
  return response
}
let response=await request('/oauth/login/kestra');assert.equal(response.status,302)
let target
for(let count=0;count<16&&[301,302,303,307,308].includes(response.status);count++) {
  target=new URL(response.headers.get('location'),base);assert.equal(target.origin,base)
  await response.body?.cancel()
  response=target.pathname==='/oidc/login'?await request('/oidc/login',{method:'POST',body:new URLSearchParams({username:'tester',password:'Passw0rd!',from:target.searchParams.get('from')})}):await request(target)
}
assert.equal(response.status,200);assert(target.pathname.startsWith('/ui/'));await response.body?.cancel()
const [header,payload,signature]=cookies.get('JWT').split('.')
const metadata=await(await request('/.well-known/openid-configuration')).json();assert.equal(metadata.issuer,base)
const key=(await(await request(metadata.jwks_uri)).json()).keys.find(key=>key.kid===JSON.parse(Buffer.from(header,'base64url')).kid)
assert(verify('RSA-SHA256',Buffer.from(header+'.'+payload),createPublicKey({key,format:'jwk'}),Buffer.from(signature,'base64url')))
const claims=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(claims.iss,base);assert.equal(claims.sub,'tester')
assert.deepEqual(Array.isArray(claims.aud)?claims.aud:[claims.aud],['kestra-ui']);assert(!Object.hasOwn(claims,'kestra_application_group_v1'))
assert.equal((await request('/api/v1/configs')).status,403)
console.log('PASS missing projection permits standard configured UI login without granting group identity')
response=await request('/oidc/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['http://127.0.0.1:19998/callback'],token_endpoint_auth_method:'none',scope:'openid'})})
assert.equal(response.status,201);const registered=await response.json()
const verifier=randomBytes(48).toString('base64url'),state=randomBytes(20).toString('hex')
response=await request('/oidc/authorize?'+new URLSearchParams({client_id:registered.client_id,redirect_uri:registered.redirect_uris[0],response_type:'code',scope:'openid',state,
  code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))
assert([302,303,307].includes(response.status));const callback=new URL(response.headers.get('location'))
assert.equal(callback.origin+callback.pathname,registered.redirect_uris[0]);assert.equal(callback.searchParams.get('state'),state)
assert.equal(callback.searchParams.get('error'),'invalid_scope');assert(!callback.searchParams.has('code'))
console.log('PASS missing projection rejects ordinary client authorization with exact invalid_scope callback and no code')
