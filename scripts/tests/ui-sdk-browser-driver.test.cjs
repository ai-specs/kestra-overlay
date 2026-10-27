const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {createStaticServer, createAdapter, validateReport} = require("../blackbox-ui-sdk.cjs");

test("static probe serves SPA navigation and real asset types without HTML fallback for missing JS", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "host-sdk-static-"));
    await fs.writeFile(path.join(root, "index.html"), "<title>sdk</title>");
    await fs.writeFile(path.join(root, "sdk.css"), ":host{display:block}");
    const server = createStaticServer(root);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal(await (await fetch(base + "/sdk/items?scope=a%2Fb")).text(), "<title>sdk</title>");
        const css = await fetch(base + "/sdk.css");
        assert.equal(css.headers.get("content-type"), "text/css");
        assert.equal(await css.text(), ":host{display:block}");
        assert.equal((await fetch(base + "/missing.js")).status, 404);
        assert.equal((await fetch(base + "/sdk/items", {method: "POST"})).status, 405);
        assert.equal((await fetch(base + "/%ZZ")).status, 400);
    } finally {
        await new Promise(resolve => server.close(resolve));
        await fs.rm(root, {recursive: true});
    }
});

test("common adapter forwards native locator keyboard and selection operations", async () => {
    const calls = [];
    const page = {locator: selector => ({press: key => calls.push(["press", selector, key]),
        selectOption: value => calls.push(["selectOption", selector, value]), focus: () => calls.push(["focus", selector])}),
        emulateMedia: value => calls.push(["media", value]), setViewportSize: value => calls.push(["viewport", value])};
    const adapter = createAdapter(page, {}, "unused");
    await adapter.press("input", "Shift+Tab");await adapter.selectOption("select", "zh_CN");await adapter.focus("button");
    await adapter.setColorScheme("dark");await adapter.setViewport({width: 390, height: 900});
    assert.deepEqual(calls, [["press", "input", "Shift+Tab"], ["selectOption", "select", "zh_CN"], ["focus", "button"],
        ["media", {colorScheme: "dark"}], ["viewport", {width: 390, height: 900}]]);
});

test("949-row release gate rejects failures unrun rows and incomplete reports", () => {
    const valid = {completed: true, passedGate: true, expectedRows: 949, passed: 949, failures: 0, notRun: 0,
        rows: Array.from({length: 949}, () => ({status: "passed"}))};
    validateReport(valid);
    for (const mutation of [{completed: false}, {passedGate: false}, {expectedRows: 194}, {passed: 948},
        {failures: 1}, {notRun: 755}, {rows: [{status: "passed"}]}]) assert.throws(() => validateReport({...valid, ...mutation}));
    const rows = structuredClone(valid.rows);rows[0].status = "failed";
    assert.throws(() => validateReport({...valid, rows}));
});

test("shared exact-text selector requires visible full element text rather than a descendant", async () => {
    let selected;
    const page = {locator: selector => ({filter: options => ({click: () => {selected = {selector, options};}})})};
    await createAdapter(page, {}, "unused").click('[role="option"]:text-is("Second")');
    assert.equal(selected.selector, '[role="option"]');assert.equal(selected.options.visible, true);
    assert(selected.options.hasText.test(" Second "));assert(!selected.options.hasText.test("Second extra"));
});
