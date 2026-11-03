export async function runOnboardingBrowserChecks(page, base, restore) {
    const checks = [];
    const assert = (name, condition, detail) => {
        checks.push({name, passed: Boolean(condition), detail});
        if (!condition) {
            const error = new Error(name);
            error.report = {completed: false, checks};
            throw error;
        }
    };
    try {
        await page.goto(`${base}/oidc/setup`);
        await page.waitForSelector('[data-setup-wait]', {state: 'visible'});
        const resource = await page.fetch('/ui/assets/oidc-login-i18n.js');
        assert('standalone-auth-entry-served-as-javascript', resource.status === 200
            && /javascript/.test(resource.headers['content-type'] ?? ''),
        {status: resource.status, headers: resource.headers, bytes: resource.body?.length});
        await page.waitForFunction(() => document.documentElement.dataset.i18nReady === 'en');
        assert('missing-component-no-account-form', await page.evaluate(() => !document.querySelector('form')));
        assert('deployment-guidance-is-visible', await page.evaluate(() => document.body.textContent.includes('docker compose restart kestra')));
        const themes = [
            ['light', 'light', 'rgb(247, 247, 248)'],
            ['dark', 'light', 'rgb(20, 24, 31)'],
            ['dark-2', 'light', 'rgb(17, 17, 21)'],
            ['syncWithSystem', 'dark', 'rgb(20, 24, 31)'],
        ];
        for (const width of [1280, 390]) {
            await page.cdp('Emulation.setDeviceMetricsOverride', {width, height: 844, deviceScaleFactor: 1, mobile: false});
            for (const [theme, system, background] of themes) {
                await page.cdp('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: system}]});
                await page.evaluate(theme => localStorage.setItem('theme', theme), theme);
                await page.goto(`${base}/oidc/setup`);
                await page.waitForSelector('[data-setup-wait]', {state: 'visible'});
                await page.press('body', 'Tab');
                await page.focus('a[href="/oidc/setup"]');
                const result = await page.evaluate(() => ({
                    background: getComputedStyle(document.body).backgroundColor,
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    focus: document.activeElement?.tagName === 'A' && getComputedStyle(document.activeElement).outlineStyle !== 'none',
                    passwordSaved: ['password', 'oidcPassword', 'setupPassword'].some(key => localStorage.getItem(key) !== null),
                }));
                assert(`wait-theme-${theme}-${width}`, result.background === background && !result.overflow && result.focus && !result.passwordSaved, result);
            }
        }
        const copy = {
            en: {title: 'Set up Kestra', waiting: 'Waiting for the initialization component. This page will check again automatically, including while Kestra restarts. No account has been created.', retry: 'Check again', create: 'Create account', rbac: 'Fine-grained access control is enabled. Creating this account also initializes the extension.', invalid: 'Provide valid account fields and configure the UI client before initialization.', failed: 'Initialization did not complete normally. Check again before retrying. If installation is locked, contact your deployment operator; do not delete the installation receipt.'},
            zh_CN: {title: '设置 Kestra', waiting: '正在等待初始化组件，页面会自动检查，包括等待 Kestra 重启恢复。尚未创建账号。', retry: '重新检查', create: '创建账号', rbac: '已启用细粒度访问控制。创建此账号时，将自动初始化应用组及权限。', invalid: '请填写有效的账号信息，并在初始化前配置 UI 客户端。', failed: '初始化未正常完成。请先重新检查，再决定是否重试。若安装已锁定，请联系部署维护者，不要删除安装凭据。'},
        };
        for (const [locale, text] of Object.entries(copy)) {
            await page.evaluate(locale => localStorage.setItem('lang', locale), locale);
            await page.goto(`${base}/oidc/setup`);
            await page.waitForFunction(locale => document.documentElement.dataset.i18nReady === locale, locale);
            const actual = await page.evaluate(() => ({title: document.title, heading: document.querySelector('h1')?.textContent, waiting: document.querySelector('[data-i18n="oidcOnboarding.waiting"]')?.textContent, retry: document.querySelector('a')?.textContent, guidance: document.querySelector('[data-setup-wait] p')?.textContent}));
            assert(`${locale}-waiting-real-copy`, actual.title === text.title && actual.heading === text.title && actual.waiting === text.waiting && actual.retry === text.retry && actual.guidance.includes('deployment/libs/') && actual.guidance.includes('docker compose restart kestra'), actual);
            await page.click('a[href="/oidc/setup"]');
            await page.waitForSelector('[data-setup-wait]', {state: 'visible'});
        }
        await page.evaluate(() => { localStorage.setItem('lang', 'zh_CN'); localStorage.setItem('theme', 'light'); });
        await page.goto(`${base}/oidc/setup`);
        await page.waitForFunction(() => document.documentElement.dataset.i18nReady === 'zh_CN');
        assert('chinese-preference-loader-is-native', await page.evaluate(() => document.documentElement.lang === 'zh-CN'));
        await page.evaluate(() => localStorage.setItem('lang', 'en'));
        await page.goto(`${base}/oidc/setup`);
        await page.waitForSelector('[data-setup-wait]', {state: 'visible'});
        await restore();
        await page.waitForSelector('input[name="password"]', {state: 'visible', timeout: 45000});
        assert('automatic-wait-recovers-fresh-csrf-without-post', await page.evaluate(() => Boolean(document.querySelector('input[name="csrf"]')?.getAttribute('value')) && !document.querySelector('[data-setup-wait]')));
        await page.press('body', 'Tab');
        await page.focus('input[name="username"]');
        assert('form-keyboard-focus', await page.evaluate(() => document.activeElement?.getAttribute('name') === 'username' && getComputedStyle(document.activeElement).outlineStyle !== 'none'));
        assert('restored-form-rbac-description', await page.evaluate(() => document.body.textContent.includes('initializes the extension')));
        for (const [locale, text] of Object.entries(copy)) {
            await page.evaluate(locale => localStorage.setItem('lang', locale), locale);
            await page.goto(`${base}/oidc/setup`);
            await page.waitForFunction(locale => document.documentElement.dataset.i18nReady === locale, locale);
            const actual = await page.evaluate(() => ({title: document.title, button: document.querySelector('button')?.textContent, rbac: document.querySelector('[data-i18n="oidcOnboarding.rbac"]')?.textContent}));
            assert(`${locale}-form-real-copy`, actual.title === text.title && actual.button === text.create && actual.rbac === text.rbac, actual);
            await page.fill('input[name="username"]', 'locale-browser-test');
            await page.fill('input[name="password"]', 'short');
            await page.evaluate(() => { document.querySelector('form').noValidate = true; });
            await page.click('button[type="submit"]');
            await page.waitForSelector('[data-i18n="oidcOnboarding.invalid"]', {state: 'visible'});
            await page.waitForFunction(locale => document.documentElement.dataset.i18nReady === locale, locale);
            const error = await page.evaluate(() => ({invalid: document.querySelector('[data-i18n="oidcOnboarding.invalid"]')?.textContent, failed: document.querySelector('[data-i18n="oidcOnboarding.failed"]')?.textContent, retry: document.querySelector('a')?.textContent, form: Boolean(document.querySelector('form'))}));
            assert(`${locale}-server-error-real-copy`, error.invalid === text.invalid && error.failed === text.failed && error.retry === text.retry && !error.form, error);
            await page.click('a[href="/oidc/setup"]');
            await page.waitForSelector('input[name="password"]', {state: 'visible'});
        }
        return {completed: true, newNonEnglishCopyVerified: true, productionFirstInstallVerified: false, checks};
    } catch (error) {
        error.report ??= {completed: false, checks, error: String(error)};
        throw error;
    }
}
