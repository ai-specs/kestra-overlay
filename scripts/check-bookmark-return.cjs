const assert = require('node:assert/strict');
const fs = require('node:fs');
const names = ['production-callback-restores-flow-bookmark', 'logout-clears-residual-return-cookie', 'no-target-keeps-default-dashboard', 'tampered-external-cookie-falls-back-same-origin'];
function checkReport(report) {
    assert.equal(report.completed, true);
    assert.deepEqual(report.checks.map(check => check.name), names);
    assert(report.checks.every(check => check.passed === true));
    assert.match(report.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(report.helperSha256, /^[a-f0-9]{64}$/);
    assert.match(report.candidateImage, /^(?:[^\s]+@)?sha256:[a-f0-9]{64}$/);
    assert.equal(report.finalInputHashesEqual, true);
    for (const [field, file] of [['sourceSha256','bookmark-return-browser.cjs'],['helperSha256','sdk-browser-diagnostics.cjs']]) {
        assert.equal(report[field], require('node:crypto').createHash('sha256').update(fs.readFileSync(require('node:path').join(__dirname,file))).digest('hex'));
    }
    assert.deepEqual(report.diagnosticSources.map(source => source.name), names);
    for (const source of report.diagnosticSources) {
        assert(Array.isArray(source.documents) && source.documents.length > 0);
        assert(Array.isArray(source.events));
        // HTTP-only cookie check has a seeded about:blank document and no page network event.
        if (source.name !== names[1]) assert(source.events.length > 0);
        assert.deepEqual(source.integrity, []);
        assert(!source.events.some(event => event.kind === 'diagnostic-integrity-error'));
    }
    assert.deepEqual(report.diagnostics.events, report.diagnosticSources.flatMap(source =>
        source.events.map(event => ({...event, sourceName: source.name, sourceEventId: source.name + ':' + event.id}))));
    const [bookmark, logout, fallback, tampered] = report.checks.map(check => check.evidence);
    assert.equal(new URL(bookmark.finalUrl).pathname, '/ui/main/flows');
    assert.equal(bookmark.originalCookieConsumed, true);
    assert.equal(logout.status, 307); assert.equal(logout.expirationCookieCount, 1);
    assert.match(logout.transport, /^HTTP cookie lifecycle check/);
    assert.equal(new URL(fallback.finalUrl).pathname, '/ui/main/dashboards');
    assert.equal(new URL(tampered.finalUrl).pathname, '/ui/main/dashboards');
    assert.equal(tampered.originalCookieConsumed, true);
    assert(tampered.destinations.length > 0);
    assert(tampered.destinations.every(url => new URL(url).origin === new URL(tampered.finalUrl).origin));
    assert.equal(new Set(report.diagnostics.events.map(event => event.sourceEventId)).size, report.diagnostics.events.length);
    assert(report.diagnostics && Array.isArray(report.diagnostics.events));
    assert.equal(report.diagnostics.events.filter(event => ['console-error','page-error','http-error','request-failed','diagnostic-integrity-error'].includes(event.kind)).length, 0);
}
module.exports = {checkReport, names};
if (require.main === module) {checkReport(JSON.parse(fs.readFileSync(process.argv[2]))); console.log('PASS: exact four production bookmark checks, input hashes and diagnostics');}
