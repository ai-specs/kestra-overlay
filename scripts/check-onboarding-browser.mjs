import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';
import {validateDiagnostics} from './onboarding-diagnostics.mjs';
export const expectedNames=['standalone-auth-entry-served-as-javascript','missing-component-no-account-form','deployment-guidance-is-visible',...[1280,390].flatMap(width=>['light','dark','dark-2','syncWithSystem'].map(theme=>`wait-theme-${theme}-${width}`)),'en-waiting-real-copy','zh_CN-waiting-real-copy','chinese-preference-loader-is-native','automatic-wait-recovers-fresh-csrf-without-post','form-keyboard-focus','restored-form-rbac-description','en-form-real-copy','en-server-error-real-copy','zh_CN-form-real-copy','zh_CN-server-error-real-copy'];
export function check(report){assert.equal(report.completed,true);assert.equal(report.newNonEnglishCopyVerified,true);assert.equal(report.productionFirstInstallVerified,false);if(report.environment!==undefined)assert.equal(report.environment,'host-http-test-service-substitute');if(report.productionFirstInstall!==undefined)assert.equal(report.productionFirstInstall,false);assert.deepEqual(report.checks.map(x=>x.name),expectedNames);assert.equal(report.checks.length,21);for(const row of report.checks)assert.equal(row.passed,true,row.name);return 21;}
export function checkFinalDiagnostics(snapshot) {
    assert.equal(snapshot.verdict?.passed, true, 'final diagnostics verdict must pass');
    return validateDiagnostics(snapshot, snapshot.verdict.expectedResponses);
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){
    let report;
    try {
        report=JSON.parse(await readFile(process.argv[2],'utf8'));
        check(report);
        checkFinalDiagnostics(JSON.parse(await readFile(process.argv[2]+'.diagnostics.json','utf8')));
        console.log('PASS: onboarding browser 21/21 exact named checks and final diagnostics');
    } catch(error) {
        if(report) await writeFile(process.argv[2],JSON.stringify({...report,completed:false,error:String(error)},null,2));
        await writeFile(process.argv[3]??process.argv[2]+'.checker-failure.json',JSON.stringify({passed:false,error:String(error)},null,2));
        throw error;
    }
}
