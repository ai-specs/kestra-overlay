const {chromium}=require('playwright');
const {writeFile}=require('node:fs/promises');
const {execFileSync}=require('node:child_process');

async function main() {
    const base=process.env.BB_BROWSER_BASE;
    const server=process.env.BB_BROWSER_SERVER;
    const postgres=process.env.BB_BROWSER_POSTGRES;
    const destination=process.env.BB_FAVICON_REPORT;
    const expected=process.env.BB_FAVICON_EXPECTED_SHA256;
    if(!base||!server||!postgres||!destination||!/^[0-9a-f]{64}$/.test(expected||''))throw new Error('Favicon image inputs required');
    const environment=JSON.parse(execFileSync('docker',['inspect','--format','{{json .Config.Env}}',server],{encoding:'utf8'}));
    const configuration=environment.find(value=>value.startsWith('KESTRA_CONFIGURATION='))?.split('\n')||[];
    const runtime={rbacEnabled:configuration.includes('kestra.rbac.enabled: true'),typedEnabled:configuration.includes('kestra.rbac.typed.enabled: true'),
        imageId:execFileSync('docker',['inspect','--format','{{.Image}}',server],{encoding:'utf8'}).trim()};
    if(!runtime.rbacEnabled||!runtime.typedEnabled)throw new Error('Runtime RBAC and typed must be enabled');
    const browser=await chromium.launch({headless:true});
    const context=await browser.newContext();
    const page=await context.newPage();
    const {createPublicFaviconDiagnostics,redactPublicFaviconEvidence}=await import('./favicon-browser-diagnostics.mjs');
    const secrets=['Passw0rd!','local-ui-secret','local-test-only'];
    const diagnostics=createPublicFaviconDiagnostics(await context.newCDPSession(page),secrets);
    await diagnostics.attach();
    const command=operation=>execFileSync('docker',['exec',server,'java','-cp','/app/kestra:/tmp/directory-command.jar','HttpDirectoryCommand','jdbc:postgresql://'+postgres+':5432/kestra',operation],{stdio:'pipe'});
    const record=report=>writeFile(destination,JSON.stringify(redactPublicFaviconEvidence({...report,runtime},secrets),null,2)+'\n');
    try {
        const {runPublicFaviconChecks}=await import('./favicon-browser-cases.mjs');
        const report=await runPublicFaviconChecks(page,base,expected,record,()=>command('disable'),()=>command('enable'),diagnostics);
        console.log('FAVICON PRODUCTION BROWSER GREEN: '+report.checks.length+' checks');
    } finally {
        await diagnostics.detach();await context.close();await browser.close();
    }
}
main().catch(()=>{console.error('Favicon browser acceptance failed; inspect the sanitized report');process.exitCode=1;});
