const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {chromium} = require('playwright');
const {createHash} = require('node:crypto');
const {createDiagnostics} = require('./sdk-browser-diagnostics.cjs');
const {checkReport} = require('./check-bookmark-return.cjs');
const redact = value => JSON.parse(JSON.stringify(value).replace(/https?:\/\/[^\s"<>]+/g, url => {try {const parsed = new URL(url); return parsed.origin + parsed.pathname;} catch {return '[redacted-url]';}}));

async function main() {
    const base = process.env.BB_BROWSER_BASE;
    const output = process.env.BB_BOOKMARK_REPORT;
    assert.match(process.env.BB_BOOKMARK_IMAGE_ID ?? '', /^sha256:[a-f0-9]{64}$/);
    assert(base && output, 'production host URL and report path required');
    const report = {completed: false, candidateImage: process.env.BB_BOOKMARK_IMAGE_ID, declaredImage: process.env.CANDIDATE_IMAGE ?? null,
        sourceSha256: createHash('sha256').update(await fs.readFile(__filename)).digest('hex'),
        helperSha256: createHash('sha256').update(await fs.readFile(require.resolve('./sdk-browser-diagnostics.cjs'))).digest('hex'),
        mode: process.env.BB_SETUP_MODE ?? 'form', checks: []};
    const persist = () => fs.writeFile(output, JSON.stringify(redact(report), null, 2) + '\n');
    await persist();
    const browser = await chromium.launch({headless: true});
    try {
        let context, page, diagnostics;
        report.diagnosticSources = [];
        const check = async (name, operation) => {
            context = await browser.newContext(); page = await context.newPage();
            const session = await context.newCDPSession(page);
            report.blobRequestEvidence ??= [];
            session.on('Network.requestWillBeSent', payload => {
                if (payload.request.url.startsWith('blob:')) report.blobRequestEvidence.push(redact({name, requestId: payload.requestId, frameId: payload.frameId,
                    loaderId: payload.loaderId, documentURL: payload.documentURL, url: payload.request.url,
                    initiator: payload.initiator, type: payload.type}));
            });
            diagnostics = createDiagnostics(session); await diagnostics.attach();
            const row = {name, passed: false}; report.checks.push(row); await persist();
            try {row.evidence = await operation(); row.passed = true;}
            catch (error) {row.error = redact(String(error.message ?? error)); await page.screenshot({path: output + '.' + name + '.png', fullPage: true}); throw error;}
            finally {
                await page.waitForLoadState('networkidle');
                const source = redact(await diagnostics.snapshot());
                report.diagnosticSources.push({name, ...source,
                    integrity: source.events.filter(event => event.kind === 'diagnostic-integrity-error')});
                report.diagnostics = {events: report.diagnosticSources.flatMap(source => source.events.map(event => ({...event, sourceName: source.name, sourceEventId: source.name + ":" + event.id})))};
                await persist(); await diagnostics.detach(); await context.close();
            }
        };
        const login = async () => {
            await page.waitForURL(url => url.origin === base && url.pathname === '/oidc/login');
            await page.locator('input[name=username]').fill('tester');
            await page.locator('input[name=password]').fill('Passw0rd!');
            await page.locator('button[type=submit]').click();
        };
        await check('production-callback-restores-flow-bookmark', async () => {
            await page.goto(base + '/ui/main/flows');
            await login();
            await page.waitForURL(base + '/ui/main/flows');
            await page.getByRole('heading').filter({hasText: 'Flows'}).waitFor();
            await page.locator('.flows-table').waitFor();
            await page.waitForFunction(() => !document.querySelector('.flows-table .kel-loading-mask'));
            assert(!(await context.cookies()).some(cookie => cookie.name === 'ORIGINAL_URI'));
            return {finalUrl: page.url(), originalCookieConsumed: true};
        });
        await check('logout-clears-residual-return-cookie', async () => {
            await context.addCookies([{name: 'ORIGINAL_URI', value: '/ui/main/flows', url: base, httpOnly: true}]);
            const response = await context.request.get(base + '/oidc/logout', {maxRedirects: 0});
            assert.equal(response.status(), 307);
            const cookies = response.headersArray().filter(header => header.name.toLowerCase() === 'set-cookie' && header.value.startsWith('ORIGINAL_URI='));
            assert.equal(cookies.length, 1, 'one effective expiration cookie required');
            assert.match(cookies[0].value, /max-age=0/i);
            assert(!(await context.cookies()).some(cookie => cookie.name === 'ORIGINAL_URI'));
            return {transport: 'HTTP cookie lifecycle check; original UI click logout covered by existing browser gate', status: response.status(), expirationCookieCount: cookies.length};
        });
        await check('no-target-keeps-default-dashboard', async () => {
            await page.goto(base + '/oauth/login/kestra');
            await login();
            await page.waitForURL(base + '/ui/main/dashboards');
            await page.getByRole('heading').filter({hasText: 'Default Dashboard'}).waitFor();
            await page.getByText('Success Ratio', {exact: true}).waitFor();
            return {finalUrl: page.url()};
        });
        await check('tampered-external-cookie-falls-back-same-origin', async () => {
            await context.request.get(base + '/oidc/logout', {maxRedirects: 0});
            await context.addCookies([{name: 'ORIGINAL_URI', value: 'https://attacker.invalid/', url: base, httpOnly: true}]);
            const destinations = [];
            page.on('framenavigated', frame => {if (frame === page.mainFrame()) destinations.push(new URL(frame.url()).origin + new URL(frame.url()).pathname);});
            await page.goto(base + '/oauth/login/kestra');
            await login();
            await page.waitForURL(base + '/ui/main/dashboards');
            assert(destinations.every(url => new URL(url).origin === base));
            assert(!(await context.cookies()).some(cookie => cookie.name === 'ORIGINAL_URI'));
            return {finalUrl: page.url(), destinations, originalCookieConsumed: true};
        });
        assert.equal(report.checks.length, 4);
        report.completed = report.checks.every(check => check.passed);

        // All unexpected source-associated errors remain failures; no blanket suppression.
        assert.equal(report.diagnostics.events.filter(event => ['console-error','page-error','http-error','request-failed','diagnostic-integrity-error'].includes(event.kind)).length, 0);
        assert.equal(report.sourceSha256, createHash('sha256').update(await fs.readFile(__filename)).digest('hex'));
        assert.equal(report.helperSha256, createHash('sha256').update(await fs.readFile(require.resolve('./sdk-browser-diagnostics.cjs'))).digest('hex'));
        report.finalInputHashesEqual = true;
        checkReport(redact(report));
        await persist();
        console.log('BOOKMARK PRODUCTION BROWSER GREEN:4/4');
    } catch (error) {
        report.completed = false; report.failure = redact(String(error.message ?? error));
        await persist(); throw error;
    } finally {await browser.close();}
}
if (require.main === module) main().catch(error => {console.error(redact(String(error.message ?? error))); process.exitCode = 1;});
