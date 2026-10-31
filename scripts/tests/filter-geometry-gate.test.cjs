const {test}=require('node:test');
const assert=require('node:assert/strict');
const {expectedGeometryIds,validateGeometryChecks}=require('../blackbox-filter-geometry.cjs');
function rows(){return expectedGeometryIds().map(id=>{const [theme,width,name]=id.split('|');return {theme,width:Number(width),name,passed:true,evidence:{triggerPopoverRelation:{trigger:'native customize-button',ariaAttribute:'aria-describedby',ariaValue:'other exact-popup',popoverId:'exact-popup'},nativeTransitionsSettled:true,sameTriggerClosed:true,sameTriggerReopened:true,afterScrollClosed:true}};});}
const reference=result=>result.find(row=>row.name==='stable-native-popup-reference-toggle-after-scroll');
test('accepts exactly ordered 64 with four reference evidence rows',()=>{const result=rows();validateGeometryChecks(result);assert.equal(result.filter(row=>row.name==='stable-native-popup-reference-toggle-after-scroll').length,4);});
for(const key of ['nativeTransitionsSettled','sameTriggerClosed','sameTriggerReopened','afterScrollClosed'])test('rejects absent native reference evidence '+key,()=>{const result=rows();delete reference(result).evidence[key];assert.throws(()=>validateGeometryChecks(result));});
for(const [name,mutate]of Object.entries({
 'old 60':result=>{for(let i=result.length-1;i>=0;i--)if(result[i].name==='stable-native-popup-reference-toggle-after-scroll')result.splice(i,1);},
 'duplicate ID':result=>{result[1]=result[0];},
 'reordered rows':result=>{[result[3],result[4]]=[result[4],result[3]];},
 'failed case':result=>{reference(result).passed=false;},
 'unrelated ARIA':result=>{reference(result).evidence.triggerPopoverRelation.ariaValue='different-popup';},
 'missing exact trigger':result=>{reference(result).evidence.triggerPopoverRelation.trigger='';},
 'unknown reference attribute':result=>{reference(result).evidence.triggerPopoverRelation.ariaAttribute='data-private-ref';},
}))test('rejects '+name,()=>{const result=rows();mutate(result);assert.throws(()=>validateGeometryChecks(result));});
