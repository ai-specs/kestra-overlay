const {test} = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {createDiagnostics} = require("../sdk-browser-diagnostics.cjs");
const {createAdapter} = require("../blackbox-ui-sdk.cjs");

async function fixture() {
    const session = new EventEmitter();
    session.send = async name => name === "Page.getFrameTree" ? {frameTree: {frame: {id: "top", loaderId: "old", url: "http://probe/old"}}} : {};
    session.detach = async () => {};
    const collector = createDiagnostics(session);await collector.attach();
    session.emit("Runtime.executionContextCreated", {context: {id: 11, auxData: {frameId: "top"}}});
    return {session, collector};
}

test("snapshots preserve shared delta shape and cannot mutate earlier snapshots", async () => {
    const {session, collector} = await fixture();
    const before = await collector.snapshot();
    session.emit("Runtime.consoleAPICalled", {type: "error", executionContextId: 11, args: [{value: "real failure"}]});
    const after = await collector.snapshot();
    const {caseDiagnosticDelta} = await import("../rbac-ui-probe/sdk-evidence.mjs");
    const delta = caseDiagnosticDelta(before, after);
    assert.equal(before.events.length, 0);assert.equal(delta.events.length, 1);assert.equal(delta.errorIds.length, 1);
    assert.equal(delta.documents[0].id, "top:old");
    after.events[0].text = "tampered";
    assert.equal((await collector.snapshot()).events[0].text, "real failure");
});

test("late old-context errors and old-request failures retain their actual document", async () => {
    const {session, collector} = await fixture();
    session.emit("Network.requestWillBeSent", {requestId: "request-old", frameId: "top", loaderId: "old", type: "Script", request: {url: "http://probe/old.js"}});
    session.emit("Page.frameNavigated", {frame: {id: "top", loaderId: "new", url: "http://probe/new"}});
    session.emit("Runtime.executionContextCreated", {context: {id: 22, auxData: {frameId: "top"}}});
    session.emit("Runtime.consoleAPICalled", {type: "error", executionContextId: 11, args: [{value: "late old console"}]});
    session.emit("Runtime.exceptionThrown", {exceptionDetails: {executionContextId: 22, text: "new exception"}});
    session.emit("Network.loadingFailed", {requestId: "request-old", errorText: "net::ERR_ABORTED", canceled: true});
    const snapshot = await collector.snapshot();
    assert.equal(snapshot.events.find(event => event.kind === "console-error").documentId, "top:old");
    assert.equal(snapshot.events.find(event => event.kind === "request-failed").documentId, "top:old");
    assert.equal(snapshot.events.find(event => event.kind === "page-error").documentId, "top:new");
    assert.equal(snapshot.documents.length, 2);
});

test("unknown context and requests are explicit integrity failures, never silently attributed", async () => {
    const {session, collector} = await fixture();
    session.emit("Runtime.consoleAPICalled", {type: "error", executionContextId: 999, args: []});
    session.emit("Network.loadingFailed", {requestId: "unknown", errorText: "failed"});
    const snapshot = await collector.snapshot();
    assert.equal(snapshot.events.filter(event => event.kind === "diagnostic-integrity-error").length, 2);
    assert.equal(snapshot.events.find(event => event.kind === "console-error").documentId, null);
});

test("screenshot artifact records exact persisted path and source document", async () => {
    const {collector} = await fixture();
    const fs = require("node:fs/promises");const os = require("node:os");const path = require("node:path");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sdk-diagnostics-"));
    try {
        const page = {screenshot: async options => fs.writeFile(options.path, "controlled screenshot")};
        await createAdapter(page, collector, directory).captureFailure(new Error("test"), "source-case");
        const snapshot = await collector.snapshot();
        assert.equal(snapshot.artifacts[0].path, path.join(directory, "source-case.png"));
        assert.equal(snapshot.artifacts[0].documentId, "top:old");
        assert.equal(await fs.readFile(snapshot.artifacts[0].path, "utf8"), "controlled screenshot");
    } finally {await fs.rm(directory, {recursive: true});}
});

test("Log browser errors and warnings preserve request or unique-document provenance", async () => {
    const {session, collector} = await fixture();
    session.emit("Network.requestWillBeSent", {requestId: "csp", frameId: "top", loaderId: "old", type: "Script", request: {url: "http://probe/blocked.js"}});
    session.emit("Page.frameNavigated", {frame: {id: "top", loaderId: "new", url: "http://probe/new"}});
    session.emit("Log.entryAdded", {entry: {level: "error", source: "security", text: "CSP rejected", networkRequestId: "csp", url: "http://probe/blocked.js"}});
    session.emit("Log.entryAdded", {entry: {level: "warning", source: "javascript", text: "Warning from old document", url: "http://probe/old"}});
    const {caseDiagnosticDelta} = await import("../rbac-ui-probe/sdk-evidence.mjs");
    const delta = caseDiagnosticDelta({events: [], documents: [], artifacts: []}, await collector.snapshot());
    const error = delta.events.find(value => value.channel === "Log.entryAdded" && value.kind === "console-error");
    const warning = delta.events.find(value => value.kind === "console-warning");
    assert.equal(error.documentId, "top:old");assert.equal(warning.documentId, "top:old");
    assert(delta.errorIds.includes(error.id));
});

test("ambiguous reused document URL and missing Log source fail integrity", async () => {
    const {session, collector} = await fixture();
    session.emit("Page.frameNavigated", {frame: {id: "top", loaderId: "reload", url: "http://probe/old"}});
    session.emit("Log.entryAdded", {entry: {level: "error", source: "security", text: "Ambiguous document", url: "http://probe/old"}});
    session.emit("Log.entryAdded", {entry: {level: "warning", source: "other", text: "Unknown origin"}});
    const snapshot = await collector.snapshot();
    assert.equal(snapshot.events.filter(value => value.kind === "diagnostic-integrity-error").length, 2);
    assert.equal(snapshot.events.find(value => value.text === "Ambiguous document").documentId, null);
});
