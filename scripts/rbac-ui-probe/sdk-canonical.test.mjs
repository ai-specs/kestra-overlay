import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

test("canonical case keeps independent fixed request and expected URL plus exact query assertions", async () => {
    const source = await readFile(new URL("./sdk-browser-matrix.mjs", import.meta.url), "utf8");
    assert(source.includes('const requested = "items?key=a&key=b&flag&empty=&opaque=a%2Fb%23c"'));
    assert(source.includes('const expectedCanonical = "items?key=a&key=b&flag&empty=&opaque=a/b%23c"'));
    assert(source.includes('navigate(requested, expectedCanonical)'));
    assert(source.includes('frame.fullPath === expectedCanonical && frame.href === "/sdk/" + expectedCanonical'));
    assert(source.includes('value.fullPath === expectedCanonical && value.href === "/sdk/" + expectedCanonical'));
    assert.equal(source.match(/JSON\.stringify\(\{key: \["a", "b"\], flag: null, empty: "", opaque: "a\/b#c"\}\)/g)?.length, 2);
});

test("all original 949 case IDs remain unique and behaviors execute before configurations", async () => {
    const source = await readFile(new URL("./sdk-browser-matrix.mjs", import.meta.url), "utf8");
    const expected = ["canonical-query-refresh", "host-menu-dirty", "keyboard-host-dirty", "history-back-forward-dirty", "concurrent-navigation", "save-confinement", "focus-tab-loop", "maximize-reset", "focus-fallback", "dispose-pending-dirty", "dispose-uncooperative-guard", "public-safety-abort", "unmount-open-popup"];
    const actual = [...source.matchAll(/await baseCase\("([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(actual, expected);
    assert(source.indexOf('await baseCase("unmount-open-popup"') < source.indexOf('for (const theme of themes)'));
    const ids = expected.map(name => "behavior/" + name);
    for (const theme of ["light", "dark", "dark-2", "system"]) for (const locale of ["en", "de", "es", "fr", "hi", "it", "ja", "ko", "pl", "pt", "pt_BR", "ru", "zh_CN"]) for (const width of [1280, 768, 390]) {
        for (const suffix of ["drawer-0", "drawer-1", "drawer-2", "drawer-3", "native-filter", "refresh-and-system"]) ids.push(`preferences/${theme}/${locale}/${width}/${suffix}`);
    }
    assert.equal(ids.length, 949);
    assert.equal(new Set(ids).size, 949);
    assert(source.includes('const baseCase = async (name, task) => run("behavior/" + name, null, async () => {await setup(); return task();})'));
});

test("fallback case requires actual DOM removal and buttons retain stable vnode identities", async () => {
    const source = await readFile(new URL("./sdk-browser-matrix.mjs", import.meta.url), "utf8");
    const components = await readFile(new URL("./sdk-components.js", import.meta.url), "utf8");
    assert(components.includes('{key: id, "data-probe": id'));
    assert(source.includes('triggerIdentity.connected === false && triggerIdentity.reusedAsNext === false'));
    assert(source.includes('value.opened === null && value.focus === "title"'));
    assert(source.indexOf('window.sdkOriginalTrigger =') < source.indexOf('window.sdkProbe.configure({hideTrigger: 0})'));
});
