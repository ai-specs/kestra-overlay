function createDiagnostics(session) {
    const documents = new Map();
    const frames = new Map();
    const contexts = new Map();
    const requests = new Map();
    const events = [];
    const artifacts = [];
    const listeners = [];
    let sequence = 0;
    let artifactSequence = 0;
    let topFrame = null;
    const copy = value => structuredClone(value);
    const event = (kind, documentId, details = {}) => {
        const entry = {id: "event-" + ++sequence, kind, documentId, ...details};
        events.push(entry);
        return entry;
    };
    const integrity = (message, details = {}) => event("diagnostic-integrity-error", null, {message, ...details});
    const document = (frameId, loaderId, url) => {
        if (!frameId || !loaderId) {integrity("Missing frame or loader identity", {frameId, loaderId, url}); return null;}
        const id = frameId + ":" + loaderId;
        if (!documents.has(id)) documents.set(id, {id, frameId, loaderId, url: url ?? ""});
        else if (url) documents.get(id).url = url;
        return id;
    };
    const bindFrame = frame => {
        const id = document(frame.id, frame.loaderId, frame.url);
        if (id) frames.set(frame.id, id);
        if (!frame.parentId) topFrame = frame.id;
        return id;
    };
    const sourceContext = contextId => {
        const source = contexts.get(contextId);
        if (!source) integrity("Unknown execution context", {executionContextId: contextId});
        return source ?? null;
    };
    const listen = (name, callback) => {
        const handler = payload => {
            try {callback(payload);} catch (error) {integrity("Cannot decode " + name, {messageDetail: String(error)});}
        };
        listeners.push([name, handler]);session.on(name, handler);
    };
    listen("Page.frameNavigated", ({frame}) => event("document", bindFrame(frame), {frameId: frame.id, loaderId: frame.loaderId, url: frame.url}));
    listen("Runtime.executionContextCreated", ({context}) => {
        const frameId = context.auxData?.frameId;
        const source = frames.get(frameId);
        if (!source) integrity("Execution context has no known document", {executionContextId: context.id, frameId});
        else contexts.set(context.id, source);
    });
    listen("Runtime.consoleAPICalled", payload => {
        const source = sourceContext(payload.executionContextId);
        event(payload.type === "error" ? "console-error" : "console-" + payload.type, source,
            {executionContextId: payload.executionContextId, text: (payload.args ?? []).map(value => value.value ?? value.description ?? value.type).join(" "), stackTrace: payload.stackTrace});
    });
    listen("Runtime.exceptionThrown", ({exceptionDetails}) => {
        const source = sourceContext(exceptionDetails.executionContextId);
        event("page-error", source, {executionContextId: exceptionDetails.executionContextId,
            text: exceptionDetails.exception?.description ?? exceptionDetails.text, url: exceptionDetails.url,
            stackTrace: exceptionDetails.stackTrace});
    });
    listen("Network.requestWillBeSent", payload => {
        let source = payload.type === "Document" ? document(payload.frameId, payload.loaderId, payload.request.url)
            : documents.has(payload.frameId + ":" + payload.loaderId) ? payload.frameId + ":" + payload.loaderId : null;
        if (!source) integrity("Request has unknown source document", {requestId: payload.requestId, frameId: payload.frameId, loaderId: payload.loaderId, url: payload.request.url});
        requests.set(payload.requestId, {documentId: source, url: payload.request.url, frameId: payload.frameId, loaderId: payload.loaderId});
        event("request", source, {requestId: payload.requestId, url: payload.request.url, frameId: payload.frameId, loaderId: payload.loaderId});
    });
    listen("Network.responseReceived", payload => {
        const request = requests.get(payload.requestId);
        if (!request) integrity("Response has unknown request", {requestId: payload.requestId, url: payload.response.url});
        event(payload.response.status >= 400 ? "http-error" : "http-response", request?.documentId ?? null,
            {requestId: payload.requestId, url: payload.response.url, status: payload.response.status});
    });
    listen("Network.loadingFailed", payload => {
        const request = requests.get(payload.requestId);
        if (!request) integrity("Failed request has unknown source", {requestId: payload.requestId});
        event("request-failed", request?.documentId ?? null, {requestId: payload.requestId, url: request?.url,
            error: payload.errorText, canceled: payload.canceled === true});
    });
    listen("Log.entryAdded", ({entry}) => {
        let source = null;
        if (entry.networkRequestId) source = requests.get(entry.networkRequestId)?.documentId ?? null;
        if (!source && entry.executionContextId !== undefined) source = contexts.get(entry.executionContextId) ?? null;
        if (!source && entry.url) {
            const candidates = [...documents.values()].filter(value => value.url === entry.url);
            if (candidates.length === 1) source = candidates[0].id;
        }
        if (!source) integrity("Browser log has unknown or ambiguous source document", {url: entry.url,
            networkRequestId: entry.networkRequestId, executionContextId: entry.executionContextId, source: entry.source, level: entry.level});
        event(entry.level === "error" ? "console-error" : "console-" + entry.level, source,
            {channel: "Log.entryAdded", source: entry.source, text: entry.text, url: entry.url,
                networkRequestId: entry.networkRequestId, executionContextId: entry.executionContextId, stackTrace: entry.stackTrace});
    });
    return {
        async attach() {
            await session.send("Page.enable");
            const seed = await session.send("Page.getFrameTree");
            const visit = tree => {bindFrame(tree.frame);for (const child of tree.childFrames ?? []) visit(child);};
            visit(seed.frameTree);
            await session.send("Network.enable");
            await session.send("Runtime.enable");
            await session.send("Log.enable");
        },
        async snapshot() {
            await session.send("Runtime.evaluate", {expression: "void 0", returnByValue: true});
            return copy({events, documents: [...documents.values()], artifacts});
        },
        currentDocument: () => frames.get(topFrame) ?? null,
        artifactReferences: () => copy(artifacts),
        artifact(path, documentId) {
            if (!documentId || !documents.has(documentId)) integrity("Screenshot has unknown source document", {path, documentId});
            const artifact = {id: "artifact-" + ++artifactSequence, path, documentId};
            artifacts.push(artifact);event("artifact", documentId, {path, artifactId: artifact.id});return copy(artifact);
        },
        async detach() {for (const [name, handler] of listeners) session.off(name, handler);await session.detach();},
    };
}

module.exports = {createDiagnostics};
