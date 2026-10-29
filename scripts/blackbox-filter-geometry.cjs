const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createStaticServer}=require('./blackbox-ui-sdk.cjs');
const {createDiagnostics}=require('./sdk-browser-diagnostics.cjs');

async function main(){
 const directory=path.resolve(process.env.UI_SDK_PROBE_DIR??'');assert(process.env.UI_SDK_PROBE_DIR);
 const output=path.resolve(process.env.FILTER_GEOMETRY_REPORT??'.work/filter-geometry.json');await fs.mkdir(path.dirname(output),{recursive:true});
 const build=JSON.parse(await fs.readFile(path.join(directory,'build-evidence.json'),'utf8'));
 const report={completed:false,checks:[],build,candidateImage:process.env.CANDIDATE_IMAGE??null,sourceSha256:createHash('sha256').update(await fs.readFile(__filename)).digest('hex')};
 const inputHashes={};
 const collect=async folder=>{for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await collect(file);else inputHashes[path.relative(directory,file)]=createHash('sha256').update(await fs.readFile(file)).digest('hex');}};
 await collect(directory);report.inputHashes=inputHashes;
 const sourceFiles=[__filename,path.join(__dirname,'rbac-ui-probe/sdk-filter-geometry.js'),path.join(__dirname,'rbac-ui-probe/sdk-filter-geometry.html'),path.join(build.sdk,'shadow-overlays.mjs'),path.join(directory,'sdk.css')];
 report.sourceSha256={};for(const file of sourceFiles)report.sourceSha256[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
 report.driverSha256=report.sourceSha256[__filename];
 const verifySources=async()=>{for(const [file,expected]of Object.entries(report.sourceSha256))assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'),expected,'geometry source changed: '+file);};
 const persist=()=>fs.writeFile(output,JSON.stringify(report,null,2)+'\n');await persist();
 const server=createStaticServer(directory);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await require('playwright').chromium.launch({headless:true});
 try{
  for(const theme of ['light','dark','dark-2','system'])for(const width of [1280,390]){
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme==='system'?'dark':'light'}),page=await context.newPage();
   const diagnostics=createDiagnostics(await context.newCDPSession(page));await diagnostics.attach();
   const check=async(name,operation)=>{
    const row={name,theme,width,passed:false,document:diagnostics.currentDocument()};const prior=new Set((await diagnostics.snapshot()).events.map(event=>event.id));report.checks.push(row);await persist();
    try{row.evidence=await operation();row.passed=true;}catch(error){row.error=String(error.message);row.partial=await page.evaluate(()=>({state:window.filterGeometry?.inspect(),mobileInsertTrace:window.__mobileInsertTrace,positionTrace:window.__filterPositionTrace,styleTrace:window.__filterStyleTrace,scrollY,root:document.querySelector('#extension')?.shadowRoot?.innerHTML}));const screenshot=output+'.'+theme+'-'+width+'-'+name+'.png';await page.screenshot({path:screenshot,fullPage:true});row.screenshot=screenshot;throw error;}finally{row.diagnostics=(await diagnostics.snapshot()).events.filter(event=>!prior.has(event.id));await persist();}
   };
   const visible=selector=>page.locator(selector).filter({visible:true});
   const panel=()=>visible(width===390?'.mobile-sheet':'.adv-builder');
   const instance=index=>page.locator('[data-filter-instance="'+index+'"]');
   const geometry=async(trigger,layer)=>{
    await layer.waitFor({state:'visible'});
    let sample;
    await page.waitForFunction(()=>!document.querySelector('#extension').shadowRoot.querySelector('.adv-builder')?.getAnimations().some(animation=>animation.playState==='running'));
    for(let retry=0;retry<30;retry++){
     const a=await trigger.boundingBox(),b=await layer.boundingBox();assert(a&&b);
     sample={trigger:a,panel:b};const expected=Math.min(Math.max(a.x,8),Math.max(8,width-b.width-8));
     if(Math.abs(b.y-(a.y+a.height+6))<=2&&Math.abs(b.x-expected)<=2)return sample;
     await page.waitForTimeout(40);
    }
    assert.fail('advanced layer not at owned trigger +6: '+JSON.stringify(sample));
   };
   let openSequence=0;
   const open=async index=>{
    report.activeStep={instance:index,openSequence:++openSequence,action:'open-customize',document:diagnostics.currentDocument()};await persist();
    const control=instance(index).locator(width===390?'.mobile-toggle':'.customize-button');await control.click();
    if(width!==390&&!await panel().isVisible())await visible('.advanced-add').click();await panel().waitFor({state:'visible'});return control;
   };
   const close=async()=>{await page.keyboard.press('Escape');await panel().waitFor({state:'hidden'});};
   const choose=async(row,label)=>{
    await row.locator('.cond-value-select .kel-select__wrapper').click();
    const option=page.getByRole('option',{name:label,exact:true}).filter({visible:true});await option.click();
   };
   try{
    await page.goto('http://127.0.0.1:'+server.address().port+'/sdk-filter-geometry.html?theme='+theme);
    await page.waitForFunction(()=>window.filterGeometry?.ready===true);const decoyBefore=await page.locator('#host-decoy').getAttribute('style');assert.equal(await page.evaluate(()=>window.filterGeometry.buildId),build.buildId);
    await check('two-owned-native-filter-instances',async()=>{
     const samples=[];
     for(const index of [0,1,0]){
      const trigger=await open(index);
      if(width!==390)samples.push(await geometry(trigger,panel()));
      else {const box=await panel().boundingBox();assert(box.x>=-1&&box.x+box.width<=width+1);samples.push({panel:box});}
      assert.equal(await page.locator('body > .adv-overlay,body > .edit-overlay,body > .mobile-sheet').count(),0);
      await close();
     }return samples;
    });
    await check('native-condition-and-nested-select-escape',async()=>{
     if(width===390) {
      await open(0);await panel().locator('.field-row-header').filter({hasText:'Kind'}).click();
      await panel().locator('.field-row-body').waitFor();
      await panel().locator('.kel-select__wrapper').click();await page.getByRole('option',{name:'First',exact:true}).filter({visible:true}).click();
      await panel().locator('.sheet-apply').click();await panel().waitFor({state:'hidden'});
      return {mobileNativeFieldClicked:true,state:await page.evaluate(()=>window.filterGeometry.inspect())};
     }
     await open(0);await panel().locator('.adv-footer .adv-add').first().click();await panel().locator('.adv-row').first().waitFor();
     await choose(panel().locator('.adv-row').first(),'First');
     await panel().locator('.cond-value-select .kel-select__wrapper').click();await page.getByRole('option',{name:'Second',exact:true}).filter({visible:true}).waitFor();
     await page.keyboard.press('Escape');assert.equal(await panel().isVisible(),true,'nested select Escape closed advanced filter');
     await panel().locator('.adv-footer .adv-add').first().click();await assert.equal(await panel().locator('.adv-row').count(),2);
     const text=panel().locator('.cond-value-input input');await text.fill('sample');await text.blur();
     await close();
     const result=await page.evaluate(()=>window.filterGeometry.inspect());assert(result.filters[0].length>=2);
     return {conditions:result.filters[0].length,query:result.queries[0],nestedEscPreservedLayer:true};
    });
    await check('rules-pill-reopen-scroll-resize',async()=>{
     const control=instance(0).locator(width===390?'.mobile-toggle':'.rules-pill');report.activeStep={instance:0,openSequence:++openSequence,action:'open-rules-pill',document:diagnostics.currentDocument()};await persist();await control.click();await panel().waitFor();
     const samples=[];
     if(width!==390){
      samples.push(await geometry(control,panel()));
      await close();const beforeScroll=await page.locator('.fixture-scroll').evaluate(node=>node.scrollTop);await page.mouse.move(width-4,500);await page.mouse.wheel(0,20);await page.waitForFunction(before=>document.querySelector('#extension').shadowRoot.querySelector('.fixture-scroll').scrollTop>before,beforeScroll);await control.click();await panel().waitFor();
      samples.push(await geometry(control,panel()));await page.locator('.fixture-scroll').evaluate(node=>node.scrollTo(0,node.scrollTop+20));samples.push({...await geometry(control,panel()),stimulus:'host-layout-scrollTo; not user wheel'});report.positionTrace=await page.evaluate(()=>window.__filterPositionTrace);await persist();await page.setViewportSize({width:width-60,height:900});
      // Wait for native reactive resize handlers and verify owned geometry even with document decoy.
      await page.waitForTimeout(100);
      const a=await control.boundingBox(),b=await panel().boundingBox();assert(Math.abs(b.y-a.y-a.height-6)<=2);assert(b.x>=7&&b.x+b.width<=width-60-7);samples.push({trigger:a,panel:b});
      await page.setViewportSize({width,height:900});
     }
     await close();return {samples,closed:true};
    });
    if(width!==390)await check('direct-chip-and-add-filter-autoopen-retain-native-position',async()=>{
     // The second instance is still simple. Native Add filters -> key plus autoopens its new chip.
     await instance(1).locator('.customize-button').click();
     const add=visible('.item').filter({hasText:'Kind'}).locator('button.unselected');
     // Public add-key button's accessible name is the field label.
     await add.click();await visible('.edit-popup').waitFor();
     const chip=instance(1).locator('.chip').first(),popup=visible('.edit-popup');
     await page.waitForFunction(()=>!document.querySelector('#extension').shadowRoot.querySelector('.edit-popup')?.getAnimations().some(animation=>animation.playState==='running'));await page.waitForTimeout(250);const a=await chip.boundingBox(),b=await popup.boundingBox();assert(a&&b);assert(Math.abs(b.x-a.x)<=2&&Math.abs(b.y-a.y-a.height-8)<=2,'native chip actual rect differs from +8px anchor');const native=await popup.evaluate((node,rect)=>({left:parseFloat(node.style.left),top:parseFloat(node.style.top),expectedLeft:rect.x+scrollX,expectedTop:rect.y+rect.height+scrollY+8,position:node.style.position}),a);assert.equal(native.position,'absolute');assert(Math.abs(native.left-native.expectedLeft)<=2&&Math.abs(native.top-native.expectedTop)<=2,'autoopened edit popup native chip calculation changed');
     await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});
     // Recreate if native closes/removes an empty condition.
     if(await chip.count()) {await chip.click();await popup.waitFor();const c=await popup.boundingBox(),d=await chip.boundingBox();const style=await popup.evaluate(node=>({left:parseFloat(node.style.left),top:parseFloat(node.style.top),scrollX,scrollY}));assert(Math.abs(style.left-d.x-style.scrollX)<=2&&Math.abs(style.top-d.y-d.height-style.scrollY-8)<=2);await page.keyboard.press('Escape');}
     return {automatic:{trigger:a,panel:b},nativeChipOffset:8};
    });
    assert.equal(await page.locator('#host-decoy').getAttribute('style'),decoyBefore,'host decoy style changed');
    await check('dispose-cleans-owned-layers-and-listeners',async()=>{
     await open(0);await page.evaluate(()=>window.filterGeometry.dispose());await page.keyboard.press('Escape');
     await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('scroll'));});
     assert.equal(await page.locator('#extension').evaluate(host=>host.shadowRoot.childNodes.length),0);
     return {disposed:true,documentOverlayCount:await page.locator('body > .adv-overlay,body > .edit-overlay,body > .mobile-sheet').count()};
    });
   }finally{
    const snapshot=await diagnostics.snapshot();report.diagnostics??=[];report.diagnostics.push({theme,width,...snapshot});await persist();await context.close();
   }
  }
  assert.equal(report.checks.length,36,'exact native geometry matrix required');
  assert.equal(report.diagnostics.length,8,'exact geometry diagnostic sources required');
  const expected=new Set();for(const theme of ['light','dark','dark-2','system'])for(const width of [1280,390])for(const name of ['two-owned-native-filter-instances','native-condition-and-nested-select-escape','rules-pill-reopen-scroll-resize',...(width===1280?['direct-chip-and-add-filter-autoopen-retain-native-position']:[]),'dispose-cleans-owned-layers-and-listeners'])expected.add(theme+'|'+width+'|'+name);
  assert.deepEqual(new Set(report.checks.map(row=>row.theme+'|'+row.width+'|'+row.name)),expected);
  const errors=report.diagnostics.flatMap(snapshot=>snapshot.events).filter(event=>['console-error','page-error','http-error','request-failed','diagnostic-integrity-error'].includes(event.kind));
  assert.equal(errors.length,0,'native geometry has source-associated browser errors');
  for(const [file,expected]of Object.entries(inputHashes))assert.equal(createHash('sha256').update(await fs.readFile(path.join(directory,file))).digest('hex'),expected,'geometry input changed during run: '+file);
  await verifySources();report.finalSourceHashesEqual=true;report.finalInputHashesEqual=true;report.completed=report.checks.every(row=>row.passed);await persist();console.log('NATIVE FILTER GEOMETRY GREEN:'+report.checks.length+'; buildId='+build.buildId);
 }catch(error){report.completed=false;report.failure=String(error.stack??error);try{await verifySources();report.finalSourceHashesEqual=true;}catch{report.finalSourceHashesEqual=false;}report.finalInputHashesEqual=true;for(const [file,expected]of Object.entries(inputHashes))if(createHash('sha256').update(await fs.readFile(path.join(directory,file))).digest('hex')!==expected)report.finalInputHashesEqual=false;await persist();throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
if(require.main===module)main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
