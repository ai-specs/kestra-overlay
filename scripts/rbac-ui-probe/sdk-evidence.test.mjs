import assert from "node:assert/strict";
import {test} from "node:test";
import {caseDiagnosticDelta} from "./sdk-evidence.mjs";

test("retains each event once across cases instead of copying accumulated diagnostics", () => {
    const events = [];
    const documents = [{id: "document:one", url: "http://localhost/probe"}];
    const rows = [];
    let before = {events: [], documents, artifacts: []};
    for (let index = 0; index < 100; index++) {
        events.push({id: "event:" + index, kind: "console-error", documentId: "document:one", message: "Retained " + index});
        const after = {events: [...events], documents, artifacts: []};
        rows.push(caseDiagnosticDelta(before, after));
        before = after;
    }
    assert.equal(rows.flatMap(row => row.events).length, 100);
    assert.equal(new Set(rows.flatMap(row => row.events.map(event => event.id))).size, 100);
    assert.equal(rows.flatMap(row => row.errorIds).length, 100);
    assert.equal(rows.at(-1).events[0].message, "Retained 99");
});

test("preserves late old-document errors with their source and only new artifacts", () => {
    const before = {events: [{id: "event:old"}], documents: [], artifacts: [{path: "before.png"}]};
    const after = {events: [...before.events,
        {id: "event:unload", kind: "console-error", documentId: "document:old", documentUrl: "http://localhost/old", message: "Old document failure"},
        {id: "event:current", kind: "page-error", documentId: "document:new", documentUrl: "http://localhost/new", message: "Current failure"},
    ], documents: [{id: "document:old", url: "http://localhost/old"}, {id: "document:new", url: "http://localhost/new"}, {id: "unrelated"}], artifacts: [...before.artifacts, {path: "case.png"}]};
    const delta = caseDiagnosticDelta(before, after);
    assert.deepEqual(delta.errorIds, ["event:unload", "event:current"]);
    assert.deepEqual(delta.documents.map(document => document.id), ["document:old", "document:new"]);
    assert.deepEqual(delta.artifacts, [{path: "case.png"}]);
    assert.equal(delta.events[0].documentUrl, "http://localhost/old");
});
