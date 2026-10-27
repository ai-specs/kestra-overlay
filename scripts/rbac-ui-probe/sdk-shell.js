import {createRouter, createWebHistory, stringifyQuery, isNavigationFailure} from "vue-router";
import {ExtensionLifecycle, extensionLocation, guardExtensionNavigation, freezeExtensionQuery} from "@host-runtime";
import * as extension from "./sdk-components.js";
import contract from "@sdk/contract.json";
import {probeMatrix, checkProbeCase} from "@sdk/probe-matrix.mjs";

const container = document.querySelector("#extension");
const status = document.querySelector("#status");
const preferences = {locale: "en", themePreference: "light", ...JSON.parse(localStorage.getItem("sdk-probe-preferences") ?? "{}")};
const errors = [];
const sentinelStyles = () => Object.fromEntries(["body", "#host-sentinel", "#host-sentinel button", "#host-sentinel input"].map(selector => {
    const style = getComputedStyle(document.querySelector(selector));
    return [selector, Object.fromEntries(["fontFamily", "fontSize", "color", "backgroundColor", "padding", "lineHeight", "borderRadius"].map(key => [key, style[key]]))];
}));
const sentinelBefore = sentinelStyles();
let mounted;
let lifecycle;
let removeGuard;
const system = matchMedia("(prefers-color-scheme: dark)");
const router = createRouter({history: createWebHistory(), routes: [
    {path: "/sdk/:pathMatch(.*)*", name: "extensions/page", component: {render: () => null}},
    {path: "/public-safety", name: "public-safety", component: {render: () => null}, meta: {anonymous: true}},
    {path: "/:pathMatch(.*)*", name: "outside", component: {render: () => null}},
]});
await router.push(location.pathname === "/" || location.pathname === "/sdk.html" ? "/sdk/items" + location.search : location.pathname + location.search);
await router.isReady();
const reportError = error => {errors.push(String(error)); status.textContent = errors.join("\n");};
const context = () => {
    const route = router.currentRoute.value;
    const path = Array.isArray(route.params.pathMatch) ? route.params.pathMatch.join("/") : String(route.params.pathMatch ?? "");
    const query = freezeExtensionQuery(route.query);
    const search = stringifyQuery(query);
    const theme = preferences.themePreference === "system" ? (system.matches ? "dark" : "light") : preferences.themePreference;
    document.documentElement.className = theme;
    return {contractVersion: 1, tenant: "main", path, fullPath: path + (search ? "?" + search : ""), query, ...preferences, theme,
        supportedLocales: contract.supportedLocales, fallbackLocale: "en", styles: ["/sdk.css"], signal: lifecycle.signal,
        apiBase: "/api/v1/main", assetBase: "/", request: () => {throw new Error("No business API in independent probe");},
        navigate: async (value, options) => {
            const next = extensionLocation(value);
            const failure = await router[options?.replace ? "replace" : "push"]({name: "extensions/page", params: {pathMatch: next.path.split("/")}, query: next.query});
            if (isNavigationFailure(failure)) throw new Error("Extension navigation rejected");
        },
    };
};
router.afterEach(async (to, _from, failure) => {
    if (failure || !lifecycle) return;
    if (to.name !== "extensions/page") {removeGuard?.(); await lifecycle.dispose();}
    else await lifecycle.update(context());
});
async function remount() {
    removeGuard?.();
    await lifecycle?.dispose();
    if (router.currentRoute.value.name !== "extensions/page") await router.push("/sdk/items");
    lifecycle = new ExtensionLifecycle(container, reportError);
    await lifecycle.start(async () => ({...extension, mount: async (...args) => {mounted = await extension.mount(...args); return mounted;}}), context());
    removeGuard = guardExtensionNavigation(router, () => lifecycle);
}
document.querySelectorAll("a[data-host]").forEach(link => link.addEventListener("click", event => {event.preventDefault(); void router.push(link.getAttribute("href"));}));
document.querySelector('[data-host="unmount"]').onclick = () => lifecycle.dispose();
document.querySelector('[data-host="remount"]').onclick = remount;
const locales = document.querySelector('[data-host="locale"]');
for (const locale of contract.supportedLocales) locales.add(new Option(locale, locale));
locales.value = preferences.locale;
document.querySelector('[data-host="theme"]').value = preferences.themePreference;
const persist = () => localStorage.setItem("sdk-probe-preferences", JSON.stringify(preferences));
locales.onchange = async () => {preferences.locale = locales.value; persist(); await lifecycle.update(context());};
document.querySelector('[data-host="theme"]').onchange = async event => {preferences.themePreference = event.target.value; persist(); await lifecycle.update(context());};
window.addEventListener("keydown", event => {if (event.altKey && ["h", "s"].includes(event.key.toLowerCase())) {event.preventDefault(); void router.push(event.key.toLowerCase() === "s" ? "/public-safety" : "/outside");}});
system.addEventListener("change", () => {if (preferences.themePreference === "system") void lifecycle.update(context());});
window.sdkProbe = {inspect: () => ({...mounted?.inspect(), buildId: __SDK_BUILD_ID__, errors: [...errors], href: location.pathname + location.search, sentinelBefore, sentinelAfter: sentinelStyles(), shadowNodes: container.shadowRoot?.childElementCount ?? 0}), navigate: value => context().navigate(value), remount, unmount: () => lifecycle.dispose(),
    matrix: probeMatrix, check: checkProbeCase, update: async value => {Object.assign(preferences, value); await lifecycle.update(context());}};
window.sdkProbe.configure = options => mounted.configure(options);
window.sdkProbe.completeSave = () => mounted.completeSave();
await remount();
status.textContent = "Candidate probe mounted; browser matrix has not run";
