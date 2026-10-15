// The same browser matrix runs through Ego locally and Chromium in host CI.
export async function runAuthThemeChecks(page, cdp, base, record = async () => {}) {
    const cases = [
        {name: 'light', theme: 'light', system: 'dark', background: 'rgb(247, 247, 248)'},
        {name: 'dark', theme: 'dark', system: 'light', background: 'rgb(20, 24, 31)'},
        {name: 'dark-2', theme: 'dark-2', system: 'light', background: 'rgb(17, 17, 21)'},
        {name: 'system-light', theme: 'syncWithSystem', system: 'light', background: 'rgb(247, 247, 248)'},
        {name: 'system-dark', theme: 'syncWithSystem', system: 'dark', background: 'rgb(20, 24, 31)'},
        {name: 'unset', theme: null, system: 'dark', background: 'rgb(20, 24, 31)', loginOnly: true},
        {name: 'invalid', theme: 'unknown', system: 'light', background: 'rgb(247, 247, 248)', loginOnly: true},
        {name: 'storage-unavailable', theme: null, system: 'dark', background: 'rgb(20, 24, 31)', loginOnly: true, blocked: true},
    ];
    const rows = [];
    let init;
    try {
        await cdp('Page.enable', {});
        for (const width of [1280, 390]) {
            await cdp('Emulation.setDeviceMetricsOverride', {width, height: 844, deviceScaleFactor: 1, mobile: false});
            for (const test of cases) {
                await cdp('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: test.system}]});
                if (init) {
                    await cdp('Page.removeScriptToEvaluateOnNewDocument', {identifier: init});
                    init = undefined;
                }
                // Set the same-origin preference before navigation. CDP init scripts are
                // needed only to simulate unavailable storage, not to select a theme.
                await page.evaluate(theme => {
                    if (theme === null) localStorage.removeItem('theme'); else localStorage.setItem('theme', theme);
                }, test.theme);
                if (test.blocked) ({identifier: init} = await cdp('Page.addScriptToEvaluateOnNewDocument', {source: `
                    const originalGet = Storage.prototype.getItem;
                    Storage.prototype.getItem = function(key) {
                        if (key === 'theme') throw new DOMException('Test storage disabled', 'SecurityError');
                        return originalGet.call(this, key);
                    };
                `}));
                for (const kind of test.loginOnly ? ['login'] : ['login', 'denied']) {
                    await page.goto(`${base}${kind === 'login' ? '/oidc/login?error=1' : '/ui/access-denied'}`);
                    await page.waitForSelector(kind === 'login' ? 'input[name=password]' : '#access-denied-title', {state: 'visible'});
                    await page.press('body', 'Tab');
                    await page.focus('button');
                    const result = await page.evaluate(kind => {
                        const panel = document.querySelector(kind === 'login' ? 'body' : '.access-denied-page');
                        const button = panel.querySelector('button');
                        const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
                        const luminance = color => rgb(color).map(c => {
                            c /= 255;
                            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                        }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
                        const contrast = (a, b) => {
                            const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
                            return (values[0] + 0.05) / (values[1] + 0.05);
                        };
                        const background = getComputedStyle(panel).backgroundColor;
                        const text = ['h1', ...(kind === 'login' ? ['label', '.error'] : ['.status', '.description'])]
                            .map(selector => {
                                const style = getComputedStyle(panel.querySelector(selector));
                                return {selector, contrast: contrast(style.color, style.backgroundColor === 'rgba(0, 0, 0, 0)' ? background : style.backgroundColor)};
                            });
                        const input = panel.querySelector('input[name=username]');
                        if (input) text.push({selector: 'input', contrast: contrast(getComputedStyle(input).color, getComputedStyle(input).backgroundColor)});
                        const buttonStyle = getComputedStyle(button);
                        text.push({selector: 'button', contrast: contrast(buttonStyle.color, buttonStyle.backgroundColor)});
                        const main = panel.querySelector('main').getBoundingClientRect();
                        return {background, text, focus: document.activeElement === button && buttonStyle.outlineStyle !== 'none',
                            overflow: document.documentElement.scrollWidth > innerWidth || main.left < 0 || main.right > innerWidth,
                            logo: Boolean(panel.querySelector('.logo')), path: location.pathname};
                    }, kind);
                    const row = {case: test.name, width, page: kind, passed: false, ...result};
                    rows.push(row);
                    await record({completed: false, rows});
                    if (result.background !== test.background || result.text.some(item => item.contrast < 4.5) || !result.focus || result.overflow ||
                        (kind === 'denied' && (result.logo || result.path !== '/ui/access-denied'))) {
                        throw new Error(`Authentication theme check failed: ${JSON.stringify(row)}`);
                    }
                    row.passed = true;
                    await record({completed: false, rows});
                    console.log(`PASS auth theme ${test.name} ${width}px ${kind}`);
                }
            }
        }
        await record({completed: true, rows});
        return rows;
    } finally {
        if (init) await cdp('Page.removeScriptToEvaluateOnNewDocument', {identifier: init});
        await cdp('Emulation.clearDeviceMetricsOverride', {});
        await cdp('Emulation.setEmulatedMedia', {features: []});
    }
}
