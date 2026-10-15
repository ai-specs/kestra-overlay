export async function runUiExtensionChecks(page, base, record = async () => {}) {
    const report = {completed: false, checks: []};
    const check = async (name, passed) => {
        report.checks.push({name, passed});
        await record(report);
        if (!passed) throw new Error(`Extension page check failed: ${name}`);
    };
    try {
        await page.waitForSelector('a[href="/ui/main/extensions/host-probe"]', {state: 'attached'});
        const collapsed = await page.evaluate(() => Boolean(document.querySelector('a[href="/ui/main/extensions/host-probe"]')?.closest('[inert]')));
        if (collapsed) await page.click('button.ks-sidebar-section__title:has-text("Plugins")');
        await page.waitForFunction(() => !document.querySelector('a[href="/ui/main/extensions/host-probe"]')?.closest('[inert]'));
        await page.hover('a[href="/ui/main/extensions/host-probe"]');
        await page.waitForFunction(() => {
            const link = document.querySelector('a[href="/ui/main/extensions/host-probe"]');
            if (!link || link.closest('[inert]')) return false;
            const rectangle = link.getBoundingClientRect();
            const target = document.elementFromPoint(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2);
            return target && link.contains(target);
        });
        await check('extension menu section expanded and interactive', true);
        await page.click('a[href="/ui/main/extensions/host-probe"]');
        await page.waitForFunction(() => location.pathname === '/ui/main/extensions/host-probe');
        await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('h1')?.textContent === 'Independent page probe');
        await check('menu opens independent module', true);
        await page.click('[aria-label="Host extension probe"] button');
        await page.waitForFunction(() => location.pathname === '/ui/main/extensions/host-probe/details');
        await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('output')?.textContent?.startsWith('details |'));
        await check('module navigation updates context', true);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('h1')?.textContent === 'Independent page probe');
        await check('direct detail refresh remounts module', true);
        const status = await page.evaluate(async () => (await fetch('/ui-extensions/main/host-probe/missing.js')).status);
        await check('missing namespace asset returns 404', status === 404);
        await page.goto(`${base}/ui/main/flows`);
        await page.waitForFunction(() => location.pathname === '/ui/main/flows' && document.body.textContent.includes('Flows'));
        await check('navigation removes independent module', await page.evaluate(() => !document.querySelector('[data-test="extension-container"]')));
        report.completed = true;
    } catch (failure) {
        report.failure = String(failure);
        report.document = await page.evaluate(() => {
            const link = document.querySelector('a[href="/ui/main/extensions/host-probe"]');
            return {path: location.pathname, generation: performance.timeOrigin, linkPresent: Boolean(link), inert: Boolean(link?.closest('[inert]'))};
        }).catch(() => ({unavailable: true}));
        throw failure;
    } finally {
        await record(report);
    }
    return report;
}
