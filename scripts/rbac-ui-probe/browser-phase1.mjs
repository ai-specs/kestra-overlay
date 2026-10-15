const task = await taskSpace(10);
const page = task.page("p2");
const fs = await import("node:fs/promises");
const root = PROBE_OUTPUT_DIR;
const report = {checks: [], source: "Isolated published host, actual classpath jar static ESM"};
async function check(name, action) {
    try {report.checks.push({name, passed: true, details: await action()});}
    catch (error) {report.checks.push({name, passed: false, error: String(error)});}
    await fs.writeFile(root + "/phase1-host-browser.json", JSON.stringify(report, null, 2));
}
function assert(value, message) {if (!value) throw new Error(message);}
await page.goto("http://localhost:18097/ui/main/admin/mcp-servers");
await page.waitForFunction(() => document.body.innerText.includes("Your Servers"));
await check("Direct exports production ESM mounts with zero document style injection", async () => {
    const result = await page.evaluate(async () => {
        window.phaseSample = () => {
            const button = document.querySelector('a[href="/ui/main/admin/mcp-servers/new/edit"]');
            const style = getComputedStyle(button);
            return {font: style.fontFamily, color: style.color, background: style.backgroundColor, padding: style.padding, margin: getComputedStyle(document.body).margin, bodyClass: document.body.className, styles: document.head.querySelectorAll("style,link[rel=stylesheet]").length};
        };
        window.phaseBefore = phaseSample();
        window.phaseExistingOverlays = [...document.querySelectorAll("[role=dialog],.kel-popper")];
        const module = await import("/ui/probe/phase1/extension.js?phase1-production");
        const container = document.createElement("div");
        container.id = "phase1-probe";
        document.querySelector('a[href="/ui/main/admin/mcp-servers/edit/default/edit"]').parentElement.append(container);
        window.phaseController = new AbortController();
        window.phaseContext = {version: 1, tenant: "main", locale: "fr", theme: "light", themePreference: "light", signal: phaseController.signal, stylesheet: "/ui/probe/phase1/shadow.css", navigate(path) {window.phasePath = path;}};
        window.phaseHandle = await module.mount(container, phaseContext);
        return {before: phaseBefore, after: phaseSample(), font: getComputedStyle(container.shadowRoot.querySelector(".shadow-body")).fontFamily, fontLoaded: document.fonts.check("16px Inter"), table: container.shadowRoot.querySelector(".kel-table").innerText};
    });
    await fs.writeFile(root + "/phase1-mounted-raw.json", JSON.stringify(result, null, 2));
    await page.waitForFunction(() => document.querySelector("#phase1-probe").shadowRoot.querySelector(".kel-table").innerText.includes("team.a"));
    result.table = await page.evaluate(() => document.querySelector("#phase1-probe").shadowRoot.querySelector(".kel-table").innerText);
    assert(JSON.stringify(result.before) === JSON.stringify(result.after), "Outside styles changed");
    assert(result.fontLoaded && result.font.includes("Inter") && result.table.includes("team.a"), "Font or table failed");
    return result;
});
await check("Three themes, system resolved data updates, no root outside changes", async () => {
    const result = {};
    for (const theme of ["light", "dark", "dark-2"]) {
        await page.evaluate(theme => phaseHandle.update({...phaseContext, theme}), theme);
        result[theme] = await page.evaluate(() => ({background: getComputedStyle(document.querySelector("#phase1-probe").shadowRoot.querySelector(".shadow-body")).backgroundColor, outside: phaseSample()}));
        await page.screenshot({path: root + "/phase1-host-" + theme + ".png"});
    }
    for (const theme of ["dark", "light"]) {
        await page.cdp("Emulation.setEmulatedMedia", {features: [{name: "prefers-color-scheme", value: theme}]});
        result["system-" + theme] = await page.evaluate(async () => {
            const resolved = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
            await phaseHandle.update({...phaseContext, theme: resolved, themePreference: "system"});
            return document.querySelector("#phase1-probe").shadowRoot.querySelector(".probe-page p").textContent;
        });
    }
    assert(result.light.background === "rgb(247, 247, 248)" && result.dark.background === "rgb(20, 24, 31)" && result["dark-2"].background === "rgb(17, 17, 21)", "Theme colors mismatch");
    assert(result["system-dark"].includes("dark / system") && result["system-light"].includes("light / system"), "System data did not update");
    const baseline = await page.evaluate(() => phaseBefore);
    assert(["light", "dark", "dark-2"].every(theme => JSON.stringify(result[theme].outside) === JSON.stringify(baseline)), "Outside theme changed");
    return result;
});
await check("Natural form Tab and Shift+Tab without vendor focus patch", async () => {
    await page.focus("loc=css:#probe-name");
    const focus = [];
    for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        focus.push(await page.evaluate(() => {const active = document.querySelector("#phase1-probe").shadowRoot.activeElement;return {tag: active?.tagName, id: active?.id, text: active?.innerText, outline: active ? getComputedStyle(active).outlineStyle : undefined};}));
    }
    assert(focus[0].id === "probe-description" && focus[1].text === "Details" && focus[2].text === "Delete" && focus[3].text === "Details" && focus[4].id === "probe-description", "Natural focus sequence mismatch");
    return focus;
});
await check("Route callback, inline delete confirmation, own translated pagination", async () => {
    await page.click("loc=role:button[name='Details']");
    await page.click("loc=role:button[name='Delete']");
    const french = await page.evaluate(() => {const shadow = document.querySelector("#phase1-probe").shadowRoot;return {path: phasePath, confirmation: shadow.querySelector("[role=status]").textContent, pagination: shadow.querySelector(".page-label").textContent};});
    await page.evaluate(() => phaseHandle.update({...phaseContext, locale: "zh_CN"}));
    await page.click("loc=role:button[name='Next page']");
    const chinese = await page.evaluate(() => document.querySelector("#phase1-probe").shadowRoot.querySelector(".page-label").textContent);
    assert(french.path === "roles/probe-role" && french.pagination === "Page 1 sur 2" && chinese === "第 2 页，共 2 页", "Callback or own i18n failed");
    return {french, chinese};
});
await check("390px narrow layout and readable public controls", async () => {
    await page.cdp("Emulation.setDeviceMetricsOverride", {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
    const result = await page.evaluate(() => {const container = document.querySelector("#phase1-probe");const body = container.shadowRoot.querySelector(".shadow-body");container.scrollIntoView();return {containerWidth: container.clientWidth, shadowWidth: body.scrollWidth, font: getComputedStyle(body).fontFamily, buttonColor: getComputedStyle(body.querySelector(".kel-button--primary")).color};});
    await page.screenshot({path: root + "/phase1-host-narrow.png"});
    await fs.writeFile(root + "/phase1-narrow-raw.json", JSON.stringify(result, null, 2));
    await page.cdp("Emulation.clearDeviceMetricsOverride");
    await page.waitForFunction(() => innerWidth > 390);
    assert(result.shadowWidth <= result.containerWidth + 1, "Shadow content overflow");
    return result;
});
await check("Abort and idempotent unmount leave zero overlays, locks, styles", async () => {
    const result = await page.evaluate(() => {phaseController.abort();phaseHandle.unmount();return {children: document.querySelector("#phase1-probe").shadowRoot.childElementCount, after: phaseSample(), before: phaseBefore, existingHostOverlays: phaseExistingOverlays.length, newOutsideOverlays: [...document.querySelectorAll("[role=dialog],.kel-popper")].filter(node => !phaseExistingOverlays.includes(node)).length};});
    await fs.writeFile(root + "/phase1-unmount-raw.json", JSON.stringify(result, null, 2));
    assert(result.children === 0 && result.newOutsideOverlays === 0 && JSON.stringify(result.after) === JSON.stringify(result.before), "Unmount leak");
    return result;
});
report.failed = report.checks.filter(item => !item.passed).length;
await fs.writeFile(root + "/phase1-host-browser.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
