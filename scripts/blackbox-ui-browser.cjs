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
        await page.getByText('Invalid username or password.').waitFor();
        await page.locator('input[name=username]').fill('tester');
        await page.locator('input[name=password]').fill('Passw0rd!');
        await page.locator('button[type=submit]').click();
        await page.waitForURL(`${base}/ui/dashboards`);
        await page.getByRole('heading').filter({hasText: 'Overview'}).waitFor();
        await page.reload();
        await page.getByRole('heading').filter({hasText: 'Overview'}).waitFor();
        if ((await context.cookies()).some(cookie => cookie.name === 'kestraBasicAuthenticated')) {
            throw new Error('OIDC must not create a Basic Auth flag');
        }
        await page.getByRole('link', {name: 'Flows', exact: true}).click();
        await page.waitForURL(`${base}/ui/main/flows`);
        await page.getByRole('heading').filter({hasText: 'Flows'}).waitFor();
        const apiStatus = await page.evaluate(async () => (await fetch('/api/v1/configs')).status);
        if (apiStatus !== 200) throw new Error(`authenticated API returned ${apiStatus}`);
        const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
        const mcpPayload = {id: 'default', serverType: 'PRIVATE', authType: 'OAUTH', disabled: false};
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
        await page.getByText("Protected by this instance's built-in OIDC server").waitFor();
        if (await page.getByText('Select a configured OIDC provider').count()) {
            throw new Error('built-in OIDC MCP editor still exposes external provider selector');
        }
        if (await page.getByText('Install Kestra').count()) {
            throw new Error('PWA install prompt obscures the MCP administration page');
        }
        const saveResponse = page.waitForResponse(response =>
            response.url().includes('/api/v1/main/mcp-servers/default') && response.request().method() === 'PUT');
        await page.getByRole('button', {name: 'Save', exact: true}).click();
        if ((await (await saveResponse).status()) < 200) throw new Error('MCP editor save failed');
        console.log('MCP EDITOR BUILT-IN OIDC AND PWA REGRESSION GREEN');
        await page.goto(`${base}/oidc/logout`);
        await page.waitForURL(`${base}/oidc/login?**`);
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
