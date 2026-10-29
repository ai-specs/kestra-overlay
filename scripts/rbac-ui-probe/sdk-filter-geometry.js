import * as Vue from 'vue';
import * as Design from '@kestra-io/design-system';
import '@kestra-io/design-system/styleBase';
import {ElConfigProvider,ID_INJECTION_KEY} from 'element-plus';
import {createI18n} from 'vue-i18n';
import {createMemoryHistory,createRouter} from 'vue-router';
import {createShadowOverlayScope,createShadowRenderer,shadowOverlayComponents,deepActiveElement} from '@sdk/shadow-overlays.mjs';

const host=document.querySelector('#extension'),root=host.attachShadow({mode:'open'});
const content=document.createElement('main'),portal=document.createElement('div');content.className='extension-body';portal.className='extension-body';
const link=document.createElement('link');link.rel='stylesheet';link.href='/sdk.css';
const loaded=new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;});root.append(link,content,portal);await loaded;
const style=document.createElement('style');style.textContent=':host{display:block}.extension-body{padding:0}.fixture-scroll{height:620px;overflow:auto}.fixture-row{margin:48px 0 96px 60px;max-width:900px}.fixture-row:nth-child(2){margin-left:86px}.fixture-spacer{height:900px}@media(max-width:500px){.fixture-row,.fixture-row:nth-child(2){margin-left:12px;margin-right:12px}}';root.append(style);
content.className+=' fixture-scroll';
const fallback=document.createElement('h1');fallback.tabIndex=-1;fallback.textContent='Native filter geometry';content.append(fallback);
const controller=new AbortController();const scope=createShadowOverlayScope({container:host,content,portal,signal:controller.signal,fallback:()=>fallback});
const renderer=createShadowRenderer(Vue,scope,{idInjectionKey:ID_INJECTION_KEY,namespace:'kel'});
const wrappers=shadowOverlayComponents(Vue,Object.fromEntries(['KsDrawer','KsDialog','KsSelect','KsPopover','KsTooltip','KsDropdown','KsDatePicker'].map(name=>[name,Design[name]])),scope);
const states=[],apps=[],events=[];let disposed=false;
const remember=event=>{const target=event.composedPath().find(node=>node?.matches?.('.customize-button,.rules-pill,.chip'));events.push({type:event.type,time:performance.now(),target:target?.className??null,instance:target?.closest('[data-filter-instance]')?.dataset.filterInstance??null});if(events.length>64)events.shift();};
root.addEventListener('pointerdown',remember,true);root.addEventListener('click',remember,true);
for(let index=0;index<2;index++) {
 const target=document.createElement('section');target.className='fixture-row';target.dataset.filterInstance=String(index);content.append(target);
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{render:()=>null}}]});await router.push('/filter-'+index);
 const state=Vue.reactive({filters:[]});states.push({state,router});
 const i18n=createI18n({legacy:false,locale:'en',fallbackLocale:'en',messages:{}});await Design.registerDesignSystemI18n(i18n);
 const app=renderer.createApp({render:()=>Vue.h(ElConfigProvider,{namespace:'kel'},()=>Vue.h('div',[
  Vue.h('h2','Filter '+index),
  Vue.h(Design.KsFilter,{configuration:{keys:[{key:'kind',label:'Kind',valueType:'select',comparators:[Design.Comparators.EQUALS],valueProvider:async()=>[{value:'first',label:'First'},{value:'second',label:'Second'}]},{key:'name',label:'Name',valueType:'text',comparators:[Design.Comparators.CONTAINS]}]},defaultScope:false,defaultTimeRange:false,buttons:{savedFilters:{shown:false},tableOptions:{shown:false}},onFilter:value=>{state.filters=value;}}),
  Vue.h('output',{'data-geometry-result':String(index)},JSON.stringify(state.filters))
 ]))});
 for(const [name,component]of Object.entries(Design))if(name.startsWith('Ks')&&component&&typeof component==='object')app.component(name,component);
 for(const [name,component]of Object.entries(wrappers))app.component(name,component);
 app.use(router);app.use(i18n);app.mount(target);apps.push(app);
}
const spacer=document.createElement('div');spacer.className='fixture-spacer';content.append(spacer);
const applyTheme=theme=>{const selected=theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):theme;document.documentElement.className=selected;host.className=selected;};
const system=()=>{if(new URLSearchParams(location.search).get('theme')==='system')applyTheme('system');};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',system);applyTheme(new URLSearchParams(location.search).get('theme')??'light');
window.filterGeometry={buildId:__SDK_BUILD_ID__,ready:true,inspect:()=>({disposed,events:events.map(event=>({...event})),scope:scope.inspect(),queries:states.map(({router})=>({...router.currentRoute.value.query})),filters:states.map(({state})=>JSON.parse(JSON.stringify(state.filters))),focused:deepActiveElement()?.outerHTML?.slice(0,300)}),dispose(){if(disposed)return;disposed=true;root.removeEventListener('pointerdown',remember,true);root.removeEventListener('click',remember,true);for(const app of apps)app.unmount();controller.abort();root.replaceChildren();}};
