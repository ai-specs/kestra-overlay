import {taskSpace} from './onboarding-playwright-adapter.mjs';
import {runOnboardingBrowserChecks} from './onboarding-browser-cases.mjs';
import {writeFile} from 'node:fs/promises';
const reportPath=process.env.OIDC_ONBOARDING_BROWSER_REPORT, base=process.env.OIDC_ONBOARDING_BROWSER_BASE;
const task=await taskSpace();
let partial = {completed:false, checks:[]};
try {const report=await runOnboardingBrowserChecks(task.page('p1'),base,async()=>writeFile(reportPath+'.ready','ready'));
 partial = report;
 await task.validate();
 await writeFile(reportPath,JSON.stringify({...report,environment:'host-http-test-service-substitute',productionFirstInstall:false},null,2));await task.finish();}
catch(error){await writeFile(reportPath,JSON.stringify({...partial,...error.report,completed:false,error:String(error),environment:'host-http-test-service-substitute',productionFirstInstall:false},null,2));await task.fail();throw error;}
