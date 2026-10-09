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
