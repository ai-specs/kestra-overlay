const task = await taskSpace(UI_EXTENSION_SPACE);
const page = task.page("p1");
const {writeFile} = await import("node:fs/promises");
await page.goto(UI_EXTENSION_BASE + "/ui/");
await page.waitForSelector('input[name="username"]', {state: "visible"});
console.log(await page.snapshot());
await page.fill('input[name="username"]', "tester");
await page.fill('input[name="password"]', "Passw0rd!");
await page.click('button[type="submit"]');
await page.waitForFunction(() => location.pathname === "/ui/main/dashboards" && document.body.textContent.includes("Dashboards"));
await page.waitForSelector('a[href="/ui/main/extensions/host-probe"]', {state: "visible"});
await page.goto(UI_EXTENSION_BASE + "/ui/main/admin/mcp-servers/edit/default/edit");
await page.waitForSelector('textarea[placeholder="Description"]', {state: "visible"});
console.log(await page.snapshot());
const {runUiExtensionChecks} = await import(UI_EXTENSION_CASES);
await runUiExtensionChecks(page, UI_EXTENSION_BASE, report => writeFile(UI_EXTENSION_REPORT, JSON.stringify(report, null, 2)));
console.log("HOST UI EXTENSION EGO CHECKS GREEN");
const {runAuthThemeChecks} = await import(UI_THEME_CASES);
const themeRows = await runAuthThemeChecks(page, (method, parameters) => page.cdp(method, parameters), UI_EXTENSION_BASE,
    report => writeFile(UI_THEME_REPORT, JSON.stringify(report, null, 2)));
console.log("HOST AUTH THEME CHECKS GREEN: " + themeRows.length);
const {runAuthI18nChecks} = await import(UI_I18N_CASES);
const languageRows = await runAuthI18nChecks(page, (method, parameters) => page.cdp(method, parameters), UI_EXTENSION_BASE,
    report => writeFile(UI_I18N_REPORT, JSON.stringify(report, null, 2)));
console.log("HOST AUTH LANGUAGE CHECKS GREEN: " + languageRows.length);
