export async function finalizePublicFaviconReport(report,diagnostics,record,restoreAccount) {
    let failed=false;
    if(restoreAccount) {
        try {await restoreAccount();}
        catch(failure) {report.cleanupFailure=String(failure);report.completed=false;failed=true;}
    }
    try {
        report.diagnostics=await diagnostics.evidence();
        if(report.diagnostics.unclassifiedErrorIds.length) {
            report.completed=false;report.finalizationFailure='Unclassified browser errors in final snapshot';failed=true;
        }
    } catch(failure) {
        report.diagnosticsFailure=String(failure);report.completed=false;failed=true;
    }
    await record(report);
    if(failed)throw new Error('Favicon final diagnostics or account cleanup failed');
}

export async function runPublicFaviconChecks(page, base, expectedSha256, record, expireSession, restoreAccount, diagnostics) {
    const report={completed:false,rbacEnabled:true,typedEnabled:true,checks:[]};
    const check=async(name,passed,evidence={})=>{
        report.checks.push({name,passed,...evidence});await record(report);
        if(!passed)throw new Error('Public favicon check failed: '+name);
    };
    const icon=async(state)=>{
        const result=await page.evaluate(async()=>{
            const response=await fetch('/favicon.ico',{cache:'no-store'});
            const bytes=await response.arrayBuffer();
            const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join('');
            const head=await fetch('/favicon.ico',{method:'HEAD',cache:'no-store'});
            return {status:response.status,mime:response.headers.get('content-type'),sha256:digest,
                headStatus:head.status,headBytes:(await head.arrayBuffer()).byteLength,headMime:head.headers.get('content-type')};
        });
        await check(state+'/get-packaged-icon',result.status===200&&result.sha256===expectedSha256&&result.mime?.startsWith('image/'),result);
        await check(state+'/head-empty-body',result.headStatus===200&&result.headBytes===0&&(!result.headMime||result.headMime===result.mime),{status:result.headStatus,bytes:result.headBytes,mime:result.headMime});
    };
    const apiStatus=(name,status)=>diagnostics.expectStatus(name,'GET','/api/v1/configs',()=>page.evaluate(async()=>(await fetch('/api/v1/configs',{redirect:'manual',cache:'no-store'})).status),[status]);
    const login=async()=>{
        await page.fill('input[name="username"]','tester');
        await page.fill('input[name="password"]','Passw0rd!');
        await diagnostics.expectNavigation('zero-authorization-navigation',async()=>{
            await page.click('button[type="submit"]');
            await page.waitForFunction(()=>location.pathname==='/ui/access-denied'&&Boolean(document.querySelector('#access-denied-title')));
        },[{method:'GET',path:'/api/v1/configs',status:403,documentPaths:['/ui/','/ui/main/dashboards','/ui/access-denied']},
            {method:'GET',path:'/ui-extensions/main/manifest',status:403,documentPaths:['/ui/']}]);
    };
    let disabled=false;
    try {
        await page.goto(base+'/oidc/login?from=%2Fui%2F');
        await page.waitForSelector('input[name="password"]',{state:'visible'});
        await check('anonymous/production-login-page',await page.evaluate(()=>location.pathname==='/oidc/login'));
        await icon('anonymous');
        await check('anonymous/business-api-still-401',(await apiStatus('anonymous-configs',401))===401);
        for(const method of ['POST','PUT']) {
            const status=await diagnostics.expectStatus('negative-method/'+method,method,'/favicon.ico',()=>page.evaluate(async method=>(await fetch('/favicon.ico',{method,redirect:'manual'})).status,method),[400,401,403,404,405]);
            await check('negative-method/'+method,status>=400,{status});
        }
        for(const path of ['/%66avicon.ico','/favicon%2eico','/favicon.ico/','/favicon2.ico']) {
            const status=await diagnostics.expectStatus('negative-path/'+path,'GET',path,()=>page.evaluate(async path=>(await fetch(path,{redirect:'manual',cache:'no-store'})).status,path),[400,401,403,404,405]);
            await check('negative-path/'+path,status>=400,{status});
        }
        await login();
        await check('zero-authorization/production-login-denied-page',await page.evaluate(()=>location.pathname==='/ui/access-denied'));
        await check('zero-authorization/business-api-still-403',(await apiStatus('zero-configs',403))===403);
        await icon('zero-authorization');
        disabled=true;await expireSession();
        await icon('stale-session');
        const staleApi=await diagnostics.expectStatus('stale-configs','GET','/api/v1/configs',()=>page.evaluate(async()=>(await fetch('/api/v1/configs',{redirect:'manual',cache:'no-store'})).status),[401,403]);
        await check('stale-session/business-api-still-denied',[401,403].includes(staleApi),{status:staleApi});
        const staleIdp=await diagnostics.expectStatus('stale-idp-session','GET','/oidc/clients',()=>page.evaluate(async()=>(await fetch('/oidc/clients',{redirect:'manual',cache:'no-store'})).status),[401]);
        await check('stale-session/idp-session-is-invalid',staleIdp===401);
        await restoreAccount();disabled=false;
        await page.click('.access-denied-page button');
        await page.waitForFunction(()=>location.pathname==='/oidc/login'&&Boolean(document.querySelector('input[name="password"]')));
        await check('logout/real-denied-page-logout-opens-login',true);
        await icon('after-logout');
        await check('logout/business-api-still-401',(await apiStatus('logout-configs',401))===401);
        await login();
        await check('logout/another-production-login-still-zero',(await apiStatus('relogin-zero-configs',403))===403);
        await icon('after-relogin');
        await page.click('.access-denied-page button');
        await page.waitForFunction(()=>location.pathname==='/oidc/login'&&Boolean(document.querySelector('input[name="password"]')));
        report.diagnostics=await diagnostics.evidence();
        await check('diagnostics/no-unclassified-errors',report.diagnostics.unclassifiedErrorIds.length===0,{unclassifiedErrorIds:report.diagnostics.unclassifiedErrorIds});
        report.completed=true;
    } catch(failure) {
        report.failure=String(failure);
        report.document=await page.evaluate(()=>({path:location.pathname,generation:performance.timeOrigin})).catch(()=>({unavailable:true}));
        throw failure;
    } finally {
        await finalizePublicFaviconReport(report,diagnostics,record,disabled?restoreAccount:null);
    }
    return report;
}
