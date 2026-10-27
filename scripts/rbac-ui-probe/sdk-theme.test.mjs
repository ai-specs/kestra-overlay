import assert from "node:assert/strict";
import {test} from "node:test";
import {contrastRatio, nativeThemeSettled, verifySystemThemePair} from "./sdk-theme.mjs";

const frame = (theme, background, color) => ({theme, themePreference: "system", hostClass: theme, drawer: {style: {background, color}, nativeTheme: {backgroundToken: background, textToken: color, backgroundTarget: background, textTarget: color, activeAnimations: 0}}});

test("rejects the real marker-updated but transitioning light observation", () => {
    const light = frame("light", "rgb(255, 255, 255)", "rgb(8, 9, 10)");
    light.drawer.style = {background: "rgb(39, 41, 50)", color: "rgb(245, 246, 246)"};
    assert.equal(nativeThemeSettled(light, "light"), false);
    light.drawer.style = {background: light.drawer.nativeTheme.backgroundTarget, color: light.drawer.nativeTheme.textTarget};
    light.drawer.nativeTheme.activeAnimations = 1;
    assert.equal(nativeThemeSettled(light, "light"), false);
    light.drawer.nativeTheme.activeAnimations = 0;
    assert.equal(nativeThemeSettled(light, "light"), true);
});

test("requires actual theme difference and opaque readable text without defining a palette", () => {
    const dark = frame("dark", "rgb(30, 32, 42)", "rgb(255, 255, 255)");
    const light = frame("light", "rgb(255, 255, 255)", "rgb(8, 9, 10)");
    assert(verifySystemThemePair(dark, light).light >= 4.5);
    assert.equal(contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)"), 21);
    assert.throws(() => verifySystemThemePair(dark, {...dark, theme: "light", hostClass: "light"}), /did not change/);
    assert.throws(() => verifySystemThemePair(dark, frame("light", "rgb(255, 255, 255)", "rgb(245, 245, 245)")), /contrast/);
    assert.throws(() => contrastRatio("rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"), /opaque/);
});
