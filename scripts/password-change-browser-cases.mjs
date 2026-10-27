import assert from "node:assert/strict";

export const PASSWORD_TRANSLATIONS = {
    de: ["Passwort", "Passwort bestätigen", "Speichern", "Abmelden"],
    en: ["Password", "Confirm password", "Save", "Logout"],
    es: ["Contraseña", "Confirmar contraseña", "Guardar", "Cerrar sesión"],
    fr: ["Mot de passe", "Confirmer le mot de passe", "Enregistrer", "Déconnexion"],
    hi: ["पासवर्ड", "पासवर्ड की पुष्टि करें", "सहेजें", "लॉगआउट"],
    it: ["Password", "Conferma password", "Salva", "Logout"],
    ja: ["パスワード", "パスワードを確認", "保存", "ログアウト"],
    ko: ["비밀번호", "비밀번호 확인", "저장", "로그아웃"],
    pl: ["Hasło", "Potwierdź hasło", "Zapisz", "Wyloguj się"],
    pt: ["Senha", "Confirmar senha", "Salvar", "Sair"],
    pt_BR: ["Senha", "Confirmar senha", "Salvar", "Sair"],
    ru: ["Пароль", "Подтвердить пароль", "Сохранить", "Выход"],
    zh_CN: ["密码", "确认密码", "保存", "注销"],
};

export async function runPasswordChangeBrowserCases(page, input, viewport) {
    const report = {checks: [], failures: [], completed: false};
    const record = (name, result) => {
        report.checks.push({name, passed: !!result});
        assert.ok(result, name);
    };
    try {
        await page.goto(`${input.baseUrl}/oidc/login`);
        await page.fill('input[name="username"]', input.username);
        await page.fill('input[name="password"]', input.temporaryPassword);
        await page.click('button[type="submit"]');
        await page.waitForURL(/\/oidc\/password$/);
        for (const width of [1280, 390]) {
            await viewport(width, 900);
            for (const theme of ["light", "dark", "dark-2", "syncWithSystem"]) {
                for (const [locale, expected] of Object.entries(input.translations ?? PASSWORD_TRANSLATIONS)) {
                    await page.evaluate(({locale, theme}) => {
                        localStorage.setItem("lang", locale);
                        localStorage.setItem("theme", theme);
                    }, {locale, theme});
                    await page.reload();
                    await page.waitForFunction(locale => document.documentElement.dataset.i18nReady === locale, locale);
                    const actual = await page.evaluate(() => ({
                        text: ["password", "confirm password", "save", "setup.logout"].map(key =>
                            document.querySelector(`[data-i18n="${key}"]`)?.textContent?.trim()),
                        title: document.title,
                        overflow: document.documentElement.scrollWidth > window.innerWidth,
                        background: getComputedStyle(document.body).backgroundColor,
                        color: getComputedStyle(document.body).color,
                    }));
                    record(`${width}/${theme}/${locale}/translations`, actual.text.every((value, index) => value && value === expected[index]) && actual.title === expected[0]);
                    const background = {light: "rgb(247, 247, 248)", dark: "rgb(20, 24, 31)", "dark-2": "rgb(17, 17, 21)", syncWithSystem: "rgb(247, 247, 248)"}[theme];
                    record(`${width}/${theme}/${locale}/layout`, !actual.overflow && actual.background === background && actual.background !== actual.color);
                }
            }
        }
        await page.evaluate(() => localStorage.setItem("theme", "syncWithSystem"));
        await viewport(390, 900, true);
        await page.reload();
        await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(20, 24, 31)");
        record("system-dark", true);
        await viewport(390, 900, false);
        await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(247, 247, 248)");
        record("system-light-without-reload", true);
        await page.focus('input[name="password"]');
        await page.press('input[name="password"]', "Tab");
        record("keyboard-confirmation-focus", await page.evaluate(() => document.activeElement?.getAttribute("name") === "confirmation"));
        record("keyboard-visible-outline", await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth) > 0));
        await page.fill('input[name="password"]', "ChangedPassword123!");
        await page.fill('input[name="confirmation"]', "MismatchPassword123!");
        await page.click('button[type="submit"]');
        await page.waitForSelector('[role="alert"]');
        record("invalid-input-retry-form", await page.evaluate(() => !!document.querySelector('input[name="confirmation"]') && !document.querySelector('input[name="password"]').value));
        await page.fill('input[name="password"]', "ChangedPassword123!");
        await page.fill('input[name="confirmation"]', "ChangedPassword123!");
        await page.click('button[type="submit"]');
        await page.waitForURL(/\/oidc\/login$/);
        record("completed-change-requires-login", await page.evaluate(() => !!document.querySelector('input[name="username"]')));
        await page.fill('input[name="username"]', input.secondUsername);
        await page.fill('input[name="password"]', input.secondTemporaryPassword);
        await page.click('button[type="submit"]');
        await page.waitForURL(/\/oidc\/password$/);
        await page.click('a[href="/oidc/logout"]');
        await page.waitForFunction(() => !location.pathname.startsWith("/oidc/password"));
        await page.goto(`${input.baseUrl}/oidc/password`);
        await page.waitForSelector('[role="alert"]');
        record("logout-removes-restricted-session", await page.evaluate(() => !document.querySelector('input[name="csrf"]') && !document.querySelector('input[name="password"]')));
        report.completed = true;
        return report;
    } catch (error) {
        report.failures.push({name: "password-browser", error: error.message});
        error.report = report;
        throw error;
    }
}
