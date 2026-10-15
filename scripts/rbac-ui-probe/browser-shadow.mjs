const task = await taskSpace(PROBE_SPACE_ID);
const page = task.page("p1");
const fs = await import("node:fs/promises");
const root = PROBE_OUTPUT_DIR;
const report = {checks: [], observations: [], errors: []};
async function check(name, action) {
    try {
        const details = await action();
        report.checks.push({name, passed: true, details});
    } catch (error) {
        report.checks.push({name, passed: false, error: String(error)});
    }
    await fs.writeFile(root + "/shadow-browser.json", JSON.stringify(report, null, 2));
}
function requireTrue(value, message) {
    if (!value) throw new Error(message);
}
await page.cdp("Runtime.enable");
await page.cdp("Log.enable");
await page.goto("http://localhost:5197/shadow.html");
await page.waitForFunction(() => window.shadowReady, undefined, {timeout: 30000});
console.log(await page.snapshot());
await check("Root outside styles and actual inherited Inter", async () => {
    const result = await page.evaluate(() => ({before: beforeShadow, after: sampleHost(), fontLoaded: document.fonts.check("16px Inter"), inherited: getComputedStyle(document.querySelector("#shadow-extension").shadowRoot.querySelector(".shadow-body")).fontFamily, documentLinks: [...document.querySelectorAll("link[rel=stylesheet]")].map(node => node.href), shadowLinks: document.querySelector("#shadow-extension").shadowRoot.querySelectorAll("link[rel=stylesheet]").length}));
    requireTrue(JSON.stringify(result.before) === JSON.stringify(result.after), "Outside style changed");
    requireTrue(result.fontLoaded && result.inherited.includes("Inter") && result.shadowLinks === 1 && result.documentLinks.length === 0, "Font or CSS ownership failed");
    return result;
});
await check("Three themes and system updates", async () => {
    const colors = {};
    for (const theme of ["light", "dark", "dark-2"]) {
        await page.evaluate(theme => setShadowPreference(theme), theme);
        colors[theme] = await page.evaluate(() => {const body = document.querySelector("#shadow-extension").shadowRoot.querySelector(".shadow-body"); return {background: getComputedStyle(body).backgroundColor, foreground: getComputedStyle(body).color, outside: sampleHost()};});
    }
    requireTrue(colors.light.background === "rgb(247, 247, 248)" && colors.dark.background === "rgb(20, 24, 31)" && colors["dark-2"].background === "rgb(17, 17, 21)", "Resolved theme mismatch");
    await page.cdp("Emulation.setEmulatedMedia", {features: [{name: "prefers-color-scheme", value: "dark"}]});
    await page.evaluate(() => setShadowPreference("system"));
    await page.waitForFunction(() => shadowContext.theme === "dark");
    colors.systemDark = await page.evaluate(() => ({...shadowContext, signal: undefined}));
    await page.cdp("Emulation.setEmulatedMedia", {features: [{name: "prefers-color-scheme", value: "light"}]});
    await page.evaluate(() => setShadowPreference("system"));
    await page.waitForFunction(() => shadowContext.theme === "light");
    colors.systemLight = await page.evaluate(() => ({...shadowContext, signal: undefined}));
    requireTrue(colors.systemDark.themePreference === "system" && colors.systemLight.themePreference === "system", "Lost system preference");
    return colors;
});
await check("Owned popover and click", async () => {
    await page.click("loc=role:button[name='Open shadow popover']");
    await page.waitForFunction(() => [...document.querySelector("#shadow-extension").shadowRoot.querySelectorAll(".kel-popover")].some(node => node.getBoundingClientRect().width > 0));
    const result = await page.evaluate(() => {const shadow = document.querySelector("#shadow-extension").shadowRoot;const popover = shadow.querySelector(".kel-popover");return {owned: !!popover.closest(".owned-popups"), outside: document.querySelectorAll(".kel-popover").length, text: popover.innerText};});
    requireTrue(result.owned && result.outside === 0 && result.text.includes("Owned shadow popover"), "Popover escaped");
    await page.click("loc=role:button[name='Open shadow popover']");
    return result;
});
await check("Dialog ownership and keyboard focus", async () => {
    await page.click("loc=role:button[name='Open shadow dialog']");
    await page.waitForSelector("loc=role:dialog[name='Shadow dialog']", {state: "visible"});
    const focus = [];
    for (let index = 0; index < 6; index++) {
        await page.keyboard.press("Tab");
        focus.push(await page.evaluate(() => {const shadow = document.querySelector("#shadow-extension").shadowRoot;return {tag: shadow.activeElement?.tagName, inDialog: !!shadow.activeElement?.closest("[role=dialog]"), outsideDialogs: document.querySelectorAll("[role=dialog]").length};}));
    }
    await fs.writeFile(root + "/shadow-focus-samples.json", JSON.stringify(focus, null, 2));
    requireTrue(focus.every(item => item.inDialog && item.outsideDialogs === 0), "Focus escaped shadow dialog");
    await page.keyboard.press("Escape");
    await page.waitForSelector("loc=role:dialog[name='Shadow dialog']", {state: "hidden"});
    const restored = await page.evaluate(() => document.querySelector("#shadow-extension").shadowRoot.activeElement?.innerText);
    requireTrue(restored === "Open shadow dialog", "Opener focus not restored");
    return {focus, restored};
});
await check("Narrow layout", async () => {
    await page.cdp("Emulation.setDeviceMetricsOverride", {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
    const result = await page.evaluate(() => ({documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, shadowWidth: document.querySelector("#shadow-extension").shadowRoot.querySelector(".shadow-body").scrollWidth}));
    await page.screenshot({path: root + "/shadow-narrow.png"});
    requireTrue(result.documentWidth <= result.viewport, "Horizontal overflow");
    await page.cdp("Emulation.clearDeviceMetricsOverride");
    return result;
});
await check("Unmount with dialog opened and idempotent cleanup", async () => {
    const dialogVisible = await page.evaluate(() => {const node = document.querySelector("#shadow-extension").shadowRoot.querySelector("[role=dialog]");return node && node.getBoundingClientRect().width > 0;});
    if (!dialogVisible) await page.click("loc=role:button[name='Open shadow dialog']");
    await page.waitForSelector("loc=role:dialog[name='Shadow dialog']", {state: "visible"});
    await page.evaluate(() => {shadowHandle.unmount(); shadowHandle.unmount();});
    await page.waitForFunction(() => !document.body.classList.contains("kel-popup-parent--hidden"));
    const result = await page.evaluate(() => ({shadowChildren: document.querySelector("#shadow-extension").shadowRoot.childElementCount, outsideDialogs: document.querySelectorAll("[role=dialog],.kel-popper").length, bodyClass: document.body.className, before: beforeShadow, after: sampleHost()}));
    requireTrue(result.shadowChildren === 0 && result.outsideDialogs === 0 && JSON.stringify(result.before) === JSON.stringify(result.after), "Unmount leaked state");
    return result;
});
report.errors = await page.evaluate(() => shadowErrors);
report.observations = (await page.events()).filter(event => event.method === "Runtime.exceptionThrown" || event.method === "Log.entryAdded");
report.failed = report.checks.filter(item => !item.passed).length;
await fs.writeFile(root + "/shadow-browser.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
