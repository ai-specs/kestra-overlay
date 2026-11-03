import assert from 'node:assert/strict';
export function validateDiagnostics(snapshot, expected) {
    const allowed = new Set();
    assert.equal(expected.length, 2, 'exactly two invalid form submissions required');
    for (const item of expected) {
        const responses = snapshot.events.filter(event => event.kind === 'http-error' && event.requestId === item.requestId && event.documentId === item.documentId && event.url === item.url && event.status === 400);
        assert.equal(responses.length, 1, 'exact expected form response required');
        allowed.add(responses[0].id);
        for (const event of snapshot.events.filter(event => event.kind === 'console-error' && event.channel === 'Log.entryAdded' && event.source === 'network' && event.networkRequestId === item.requestId && event.documentId === item.documentId && event.url === item.url && /^Failed to load resource: the server responded with a status of 400\b/.test(event.text))) allowed.add(event.id);
    }
    const failures = snapshot.events.filter(event => ['console-error', 'page-error', 'request-failed', 'http-error', 'diagnostic-integrity-error'].includes(event.kind) && !allowed.has(event.id));
    assert.deepEqual(failures, [], 'unexpected browser diagnostic');
    return {passed: true, expectedResponses: expected, allowedEventIds: [...allowed]};
}
