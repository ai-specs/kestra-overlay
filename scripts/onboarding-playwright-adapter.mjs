import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {validateDiagnostics} from './onboarding-diagnostics.mjs';
const require = createRequire(import.meta.url);
const {createDiagnostics} = require('./sdk-browser-diagnostics.cjs');
export async function taskSpace() {
    const {chromium} = require('playwright');
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const diagnostics = createDiagnostics(cdp);
    await diagnostics.attach();
    const expected = [];
    const adapter = {
        goto: url => page.goto(url), waitForSelector: (selector, options) => page.waitForSelector(selector, options),
        waitForFunction: (fn, arg, options) => page.waitForFunction(fn, arg, options), evaluate: (fn, arg) => page.evaluate(fn, arg),
        click: async selector => {
            if (selector !== 'button[type="submit"]') return page.locator(selector).click();
            const before = await diagnostics.snapshot();
            const ids = new Set(before.events.map(event => event.id));
            const response = page.waitForResponse(response => response.request().isNavigationRequest() && response.request().method() === 'POST' && response.url() === page.url());
            await page.locator(selector).click();
            const actual = await response;
            const snapshot = await diagnostics.snapshot();
            const rows = snapshot.events.filter(event => !ids.has(event.id) && event.kind === 'http-error' && event.url === actual.url() && event.status === 400);
            if (actual.status() !== 400 || rows.length !== 1) throw new Error('Expected exact invalid-form navigation response');
            expected.push({requestId: rows[0].requestId, documentId: rows[0].documentId, url: rows[0].url});
        },
        fill: (selector, value) => page.locator(selector).fill(value), press: (selector, key) => page.locator(selector).press(key), focus: selector => page.locator(selector).focus(),
        cdp: (method, params) => cdp.send(method, params),
        fetch: url => page.evaluate(async url => {const response = await fetch(url); return {status: response.status, headers: Object.fromEntries(response.headers), body: await response.text()};}, url),
    };
    const save = async validate => {
        const snapshot = await diagnostics.snapshot();
        let verdict;
        try { verdict = validateDiagnostics(snapshot, expected); }
        catch (error) { verdict = {passed: false, error: String(error), expectedResponses: expected}; }
        await writeFile(process.env.OIDC_ONBOARDING_BROWSER_REPORT + '.diagnostics.json', JSON.stringify({...snapshot, verdict}, null, 2));
        if (validate && !verdict.passed) throw new Error(verdict.error);
    };
    return {spaceId: 'playwright', page: () => adapter,
        validate: () => save(true),
        finish: async () => {await save(false); await browser.close();},
        fail: async () => {
            const file = process.env.OIDC_ONBOARDING_BROWSER_REPORT + '.png';
            await page.screenshot({path: file, fullPage: true}); diagnostics.artifact(file, diagnostics.currentDocument());
            await save(false); await browser.close();
        }};
}
