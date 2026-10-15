const task = await taskSpace(10);
const page = task.page("p2");
const fs = await import("node:fs/promises");
const root = PROBE_OUTPUT_DIR;
await page.goto("http://localhost:18097/ui/main/admin/mcp-servers");
await page.waitForFunction(() => document.body.innerText.includes("Your Servers"));
const result = await page.evaluate(async () => {
    window.hostShadowSample = () => {
        const anchor = document.querySelector('a[href="/ui/main/admin/mcp-servers/new/edit"]');
        const style = getComputedStyle(anchor);
        return {font: style.fontFamily, color: style.color, background: style.backgroundColor, padding: style.padding, bodyMargin: getComputedStyle(document.body).margin, bodyClass: document.body.className, headStyles: document.head.querySelectorAll("style,link[rel=stylesheet]").length};
    };
    window.hostBefore = hostShadowSample();
    const module = await import("/ui/probe/shadow/extension.js?production-v2");
    const container = document.createElement("div");
    container.id = "live-shadow-probe";
    document.querySelector('a[href="/ui/main/admin/mcp-servers/edit/default/edit"]').parentElement.append(container);
    window.hostShadowController = new AbortController();
    window.hostShadowContext = {version: 1, tenant: "main", locale: "fr", theme: "light", themePreference: "light", signal: hostShadowController.signal, stylesheet: "/ui/probe/shadow/shadow.css"};
    window.hostShadowHandle = await module.mount(container, hostShadowContext);
    return {mounted: {before: hostBefore, after: hostShadowSample(), font: getComputedStyle(container.shadowRoot.querySelector(".shadow-body")).fontFamily, fontLoaded: document.fonts.check("16px Inter"), shadowLinks: container.shadowRoot.querySelectorAll("link").length}};
});
await page.click("loc=role:button[name='Open shadow popover']");
await page.waitForFunction(() => {const node = document.querySelector("#live-shadow-probe").shadowRoot.querySelector(".kel-popover"); return node && node.getBoundingClientRect().width > 0;});
result.popover = await page.evaluate(() => ({outside: document.querySelectorAll(".kel-popover").length, inside: !!document.querySelector("#live-shadow-probe").shadowRoot.querySelector(".owned-popups .kel-popover")}));
await page.click("loc=role:button[name='Open shadow popover']");
await page.click("loc=role:button[name='Open shadow dialog']");
await page.waitForSelector("loc=role:dialog[name='Shadow dialog']", {state: "visible"});
result.focus = [];
for (let index = 0; index < 6; index++) {
    await page.keyboard.press(index % 2 ? "Shift+Tab" : "Tab");
    result.focus.push(await page.evaluate(() => {const shadow = document.querySelector("#live-shadow-probe").shadowRoot; return {inside: !!shadow.activeElement?.closest("[role=dialog]"), tag: shadow.activeElement?.tagName};}));
}
await page.screenshot({path: root + "/shadow-published-host-dialog.png"});
await page.keyboard.press("Escape");
await page.waitForSelector("loc=role:dialog[name='Shadow dialog']", {state: "hidden"});
result.themes = {};
for (const theme of ["light", "dark", "dark-2"]) {
    await page.evaluate(theme => hostShadowHandle.update({...hostShadowContext, theme}), theme);
    result.themes[theme] = await page.evaluate(() => ({color: getComputedStyle(document.querySelector("#live-shadow-probe").shadowRoot.querySelector(".shadow-body")).backgroundColor, outside: hostShadowSample()}));
    await page.screenshot({path: root + "/shadow-published-host-" + theme + ".png"});
}
result.after = await page.evaluate(() => {hostShadowController.abort(); return {outside: hostShadowSample(), shadowChildren: document.querySelector("#live-shadow-probe").shadowRoot.childElementCount, bodyClass: document.body.className};});
result.passed = JSON.stringify(result.mounted.before) === JSON.stringify(result.mounted.after) && result.popover.outside === 0 && result.popover.inside && result.focus.every(item => item.inside) && result.after.shadowChildren === 0 && JSON.stringify(result.mounted.before) === JSON.stringify(result.after.outside);
await fs.writeFile(root + "/shadow-in-published-host.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
