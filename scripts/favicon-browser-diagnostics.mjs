import {createDiagnostics} from './sdk-browser-diagnostics.cjs';

export function redactPublicFaviconEvidence(value, secrets=[]) {
    const scrub=text=>{
        let result=text.replace(/https?:\/\/[^\s"'<>]+/g,raw=>{
            try {const url=new URL(raw);url.username='';url.password='';url.search='';url.hash='';return raw===url.origin?url.origin:url.href;} catch {return '[redacted-url]';}
        }).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[redacted-jwt]')
            .replace(/\b(code|state|from|access_token|refresh_token|id_token|client_secret|password)=([^\s&"']+)/gi,'$1=[redacted]')
            .replace(/(["']?(?:code|state|from|access_token|refresh_token|id_token|client_secret|password)["']?\s*:\s*)["'][^"']*["']/gi,'$1"[redacted]"');
        for(const secret of secrets.filter(Boolean))result=result.split(secret).join('[redacted]').split(encodeURIComponent(secret)).join('[redacted]');
        return result;
    };
    const visit=input=>{
        if(typeof input==='string')return scrub(input);
        if(Array.isArray(input))return input.map(visit);
        if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).map(([key,entry])=>
            [key,/^(password|secret|clientSecret|access_token|refresh_token|id_token|code|state|from|cookie|authorization)$/i.test(key)?'[redacted]':visit(entry)]));
        return input;
    };
    return visit(structuredClone(value));
}

export function createPublicFaviconDiagnostics(session,secrets=[]) {
    const collector=createDiagnostics(session);
    const methods=new Map();
    const expectedRequests=[];
    const requestListener=payload=>methods.set(payload.requestId,payload.request.method);
    const errorKinds=new Set(['console-error','page-error','http-error','request-failed','diagnostic-integrity-error']);
    const pathOf=url=>{try{return new URL(url).pathname;}catch{return null;}};
    const originOf=url=>{try{return new URL(url).origin;}catch{return null;}};
    const admit=(name,event)=>{
        if(!event.documentId||!event.requestId||!methods.has(event.requestId))throw new Error('Expected rejection has incomplete request identity');
        const entry=Object.freeze({name,documentId:event.documentId,requestId:event.requestId,method:methods.get(event.requestId),origin:originOf(event.url),path:pathOf(event.url),status:event.status,httpErrorId:event.id});
        expectedRequests.push(entry);return entry;
    };
    return {
        async attach() {session.on('Network.requestWillBeSent',requestListener);await collector.attach();},
        async expectStatus(name,method,path,operation,statuses) {
            const before=await collector.snapshot();const documentId=collector.currentDocument();
            const document=before.documents.find(document=>document.id===documentId);
            const result=await operation();const snapshot=await collector.snapshot();
            const matches=snapshot.events.slice(before.events.length).filter(event=>event.kind==='http-error'&&event.documentId===documentId
                &&methods.get(event.requestId)===method&&pathOf(event.url)===path&&event.status===result&&originOf(event.url)===originOf(document?.url));
            if(!statuses.includes(result)||matches.length!==1)throw new Error('Expected rejection source mismatch: '+name);
            admit(name,matches[0]);return result;
        },
        async expectNavigation(name,operation,rules) {
            const before=await collector.snapshot();
            const initialDocument=collector.currentDocument();
            const navigationOrigin=originOf(before.documents.find(document=>document.id===initialDocument)?.url);
            let wake;let version=0;let expired=false;
            const responseListener=()=>{version++;wake?.();};
            session.on('Network.responseReceived',responseListener);
            const timer=setTimeout(()=>{expired=true;wake?.();},10000);
            try {
                await operation();
                let matches=[];
                while(true) {
                    const observedVersion=version;
                    const snapshot=await collector.snapshot();
                    const documents=new Map(snapshot.documents.map(document=>[document.id,document]));
                    const newDocuments=new Set(snapshot.events.slice(before.events.length).filter(event=>event.kind==='document').map(event=>event.documentId));
                    matches=snapshot.events.slice(before.events.length).filter(event=>event.kind==='http-error').map(event=>{
                        const document=documents.get(event.documentId);
                        const rule=rules.find(rule=>rule.method===methods.get(event.requestId)&&rule.path===pathOf(event.url)&&rule.status===event.status
                            &&rule.documentPaths.includes(pathOf(document?.url))&&newDocuments.has(event.documentId)
                            &&originOf(event.url)===navigationOrigin&&originOf(document?.url)===navigationOrigin);
                        return rule?{event,rule}:null;
                    }).filter(Boolean);
                    if(rules.every(rule=>matches.some(match=>match.rule===rule)))break;
                    if(expired)throw new Error('Expected navigation rejection was not observed: '+name);
                    if(observedVersion!==version)continue;
                    await new Promise(resolve=>{wake=resolve;if(observedVersion!==version||expired)resolve();});
                }
                for(const {event,rule} of matches)admit(name+'/'+rule.path,event);
            } finally {
                clearTimeout(timer);session.off('Network.responseReceived',responseListener);
            }
        },
        async evidence() {
            const snapshot=await collector.snapshot();const expectedErrorIds=[];
            for(const event of snapshot.events.filter(event=>errorKinds.has(event.kind))) {
                const expected=expectedRequests.find(request=>request.documentId===event.documentId
                    &&request.requestId===(event.requestId||event.networkRequestId));
                if(expected&&event.kind==='http-error'&&event.id===expected.httpErrorId)expectedErrorIds.push(event.id);
                else if(expected&&event.kind==='console-error'&&event.channel==='Log.entryAdded'&&event.source==='network'
                    &&pathOf(event.url)===expected.path&&originOf(event.url)===expected.origin
                    &&event.text===`Failed to load resource: the server responded with a status of ${expected.status} (${({400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',405:'Method Not Allowed'})[expected.status]})`)
                    expectedErrorIds.push(event.id);
            }
            const unclassifiedErrorIds=snapshot.events.filter(event=>errorKinds.has(event.kind)&&!expectedErrorIds.includes(event.id)).map(event=>event.id);
            return redactPublicFaviconEvidence({...snapshot,expectedRequests,expectedErrorIds,unclassifiedErrorIds},secrets);
        },
        async detach() {session.off('Network.requestWillBeSent',requestListener);await collector.detach();}
    };
}
