import expectations from './auth-i18n-expectations.json' with {type: 'json'};

// Generated expectations are copied from the pinned upstream catalogues, never translated here.
export async function runAuthI18nChecks(page, cdp, base, record = async () => {}) {
    const rows = [];
    try {
        for (const width of [1280, 390]) {
            await cdp('Emulation.setDeviceMetricsOverride', {width, height: 844, deviceScaleFactor: 1, mobile: false});
            for (const [locale, messages] of Object.entries(expectations)) {
                await page.evaluate(locale => localStorage.setItem('lang', locale), locale);
                for (const kind of ['login', 'denied']) {
                    await page.goto(`${base}${kind === 'login' ? '/oidc/login?error=1' : '/ui/access-denied'}`);
                    if (kind === 'login') await page.waitForFunction(locale => document.documentElement.dataset.i18nReady === locale, locale);
                    else await page.waitForSelector('#access-denied-title', {state: 'visible'});
                    const result = await page.evaluate(kind => {
                        const panel = document.querySelector(kind === 'login' ? 'body' : '.access-denied-page');
                        const text = kind === 'login'
                            ? Object.fromEntries([...panel.querySelectorAll('[data-i18n]')].map(element => [element.dataset.i18n, element.textContent]))
                            : {'errors.403.title': panel.querySelector('h1').textContent,
                                'errors.403.content': panel.querySelector('.description').textContent,
                                'setup.login': panel.querySelector('button').textContent};
                        const main = panel.querySelector('main').getBoundingClientRect();
                        return {lang: document.documentElement.lang, text, title: document.title,
                            overflow: document.documentElement.scrollWidth > innerWidth || main.left < 0 || main.right > innerWidth};
                    }, kind);
                    const row = {locale, width, page: kind, passed: false, ...result};
                    rows.push(row);
                    await record({completed: false, rows});
                    if (result.lang !== locale.replaceAll('_', '-') || result.overflow ||
                        Object.entries(result.text).some(([key, value]) => value.trim() !== messages[key]) ||
                        (kind === 'login' && result.title !== messages['setup.login_title'])) {
                        throw new Error(`Authentication i18n check failed: ${JSON.stringify(row)}`);
                    }
                    row.passed = true;
                    await record({completed: false, rows});
                    console.log(`PASS auth i18n ${locale} ${width}px ${kind}`);
                }
            }
        }
        await record({completed: true, rows});
        return rows;
    } finally {
        await page.evaluate(() => localStorage.setItem('lang', 'en'));
        await cdp('Emulation.clearDeviceMetricsOverride', {});
    }
}
