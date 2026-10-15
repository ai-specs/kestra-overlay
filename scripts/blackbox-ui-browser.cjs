const { chromium } = require('playwright');

async function main() {
    const base = process.env.BB_BROWSER_BASE;
    if (!base) throw new Error('BB_BROWSER_BASE is required');
    const browser = await chromium.launch({headless: true});
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${base}/ui/`);
        if (process.env.BB_BROWSER_SETUP === '1') {
            await page.waitForURL(`${base}/oidc/setup`);
            await page.locator('input[name=username]').fill('tester');
            await page.locator('input[name=name]').fill('Tester');
            await page.locator('input[name=email]').fill('tester@local.test');
            await page.locator('input[name=password]').fill('Passw0rd!');
            await page.locator('button[type=submit]').click();
            console.log('BROWSER FIRST-INSTALL OIDC SETUP COMPLETE');
        }
        await page.waitForURL(`${base}/oidc/login?**`);
        await page.locator('input[name=username]').fill('tester');
        await page.locator('input[name=password]').fill('wrong-password');
        await page.locator('button[type=submit]').click();
        await page.getByText('Invalid username or password. Make sure your credentials are correct.', {exact: true}).waitFor();
        await page.locator('input[name=username]').fill('tester');
        await page.locator('input[name=password]').fill('Passw0rd!');
        await page.locator('button[type=submit]').click();
        await page.waitForURL(`${base}/ui/main/dashboards`);
        // The header starts as Overview, then changes to Default Dashboard after
        // the bundled definition loads. Wait for the final page and real charts.
        await page.getByRole('heading').filter({hasText: 'Default Dashboard'}).waitFor();
        await page.getByText('Success Ratio', {exact: true}).waitFor();
        await page.reload();
        await page.getByRole('heading').filter({hasText: 'Default Dashboard'}).waitFor();
        await page.getByText('Success Ratio', {exact: true}).waitFor();
        if ((await context.cookies()).some(cookie => cookie.name === 'kestraBasicAuthenticated')) {
            throw new Error('OIDC must not create a Basic Auth flag');
        }
        await page.getByRole('link', {name: 'Flows', exact: true}).click();
        await page.waitForURL(`${base}/ui/main/flows`);
        await page.getByRole('heading').filter({hasText: 'Flows'}).waitFor();
        const apiStatus = await page.evaluate(async () => (await fetch('/api/v1/configs')).status);
        if (apiStatus !== 200) throw new Error(`authenticated API returned ${apiStatus}`);
        const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
        const mcpPayload = {id: 'default', description: 'OIDC browser acceptance initial', serverType: 'PRIVATE', authType: 'OAUTH', disabled: false};
        const mcpStatus = await page.evaluate(async ({csrf, payload}) => {
            const headers = {'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf || ''};
            const existing = await fetch('/api/v1/main/mcp-servers/default');
            const response = existing.ok
                ? await fetch('/api/v1/main/mcp-servers/default', {method: 'PUT', headers, body: JSON.stringify(payload)})
                : await fetch('/api/v1/main/mcp-servers', {method: 'POST', headers, body: JSON.stringify(payload)});
            return response.status;
        }, {csrf, payload: mcpPayload});
        if (mcpStatus < 200 || mcpStatus >= 300) throw new Error(`MCP server setup returned ${mcpStatus}`);
        await page.goto(`${base}/ui/main/admin/mcp-servers/edit/default/edit`);
        const description = page.locator('textarea[placeholder="Description"]');
        await description.waitFor();
        await page.waitForFunction(() => document.querySelector('textarea[placeholder="Description"]')?.value === 'OIDC browser acceptance initial');
        await page.getByText("Protected by this instance's built-in OIDC server").waitFor();
        if (await page.getByText('Select a configured OIDC provider').count()) {
            throw new Error('built-in OIDC MCP editor still exposes external provider selector');
        }
        if (await page.getByText('Install Kestra').count()) {
            throw new Error('PWA install prompt obscures the MCP administration page');
        }
        await description.fill('OIDC browser acceptance saved');
        const [savedResponse] = await Promise.all([
            page.waitForResponse(response => response.url().includes('/api/v1/main/mcp-servers/default') && response.request().method() === 'PUT'),
            page.getByRole('button', {name: 'Save', exact: true}).click(),
        ]);
        const submitted = savedResponse.request().postDataJSON();
        if (submitted.description !== 'OIDC browser acceptance saved') throw new Error('MCP editor submitted an unexpected description');
        if (savedResponse.status() < 200 || savedResponse.status() >= 300) throw new Error(`MCP editor save failed (${savedResponse.status()})`);
        const persistedDescription = await page.evaluate(async () => (await (await fetch('/api/v1/main/mcp-servers/default')).json()).description);
        if (persistedDescription !== 'OIDC browser acceptance saved') throw new Error('MCP editor save did not persist description');
        console.log('MCP EDITOR BUILT-IN OIDC AND PWA REGRESSION GREEN');
        const {runAuthThemeChecks} = await import('./auth-theme-cases.mjs');
        const themeSession = await context.newCDPSession(page);
        const fs = require('node:fs');
        fs.mkdirSync('.work', {recursive: true});
        const themeReport = `.work/auth-theme-${process.env.BB_BROWSER_SETUP === '1' ? 'setup' : 'env'}.json`;
        const themeRows = await runAuthThemeChecks(page, (method, params) => themeSession.send(method, params), base,
            report => fs.writeFileSync(themeReport, JSON.stringify(report, null, 2)));
        console.log(`AUTHENTICATION THEME MATRIX GREEN: ${themeRows.length} checks`);
        const {runAuthI18nChecks} = await import('./auth-i18n-cases.mjs');
        const i18nReport = `.work/auth-i18n-${process.env.BB_BROWSER_SETUP === '1' ? 'setup' : 'env'}.json`;
        const i18nRows = await runAuthI18nChecks(page, (method, params) => themeSession.send(method, params), base,
            report => fs.writeFileSync(i18nReport, JSON.stringify(report, null, 2)));
        console.log(`AUTHENTICATION I18N MATRIX GREEN: ${i18nRows.length} checks`);
        // The logout endpoint intentionally redirects while clearing the OIDC session. Chromium
        // reports that redirect as ERR_ABORTED when the navigation is superseded; wait for the
        // redirect target and keep the authentication assertions below.
        try {
            await page.goto(`${base}/oidc/logout`, {waitUntil: 'domcontentloaded'});
        } catch (error) {
            if (!String(error?.message || error).includes('ERR_ABORTED')) throw error;
        }
        await page.waitForURL(`${base}/oidc/login?**`);
        await page.locator('input[name=password]').waitFor();
        await page.waitForFunction(() => document.documentElement.dataset.i18nReady === 'en');
        const deniedStatus = await page.evaluate(async () => (await fetch('/api/v1/configs')).status);
        if (deniedStatus !== 401) throw new Error(`logged-out API returned ${deniedStatus}`);
        const setupStatus = await page.evaluate(async () => (await fetch('/oidc/setup')).status);
        if (setupStatus !== 404) throw new Error(`completed setup remains open (${setupStatus})`);
        console.log('BROWSER OIDC LOGIN, REFRESH, NAVIGATION AND LOGOUT ALL GREEN');
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
