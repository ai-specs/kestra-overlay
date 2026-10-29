import {build} from "vite";
import vue from "@vitejs/plugin-vue";
import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import postcss from "postcss";

const tree = resolve(process.env.SDK_DEV_TREE ?? "..");
const sdk = resolve(tree, "webserver/src/main/resources/META-INF/kestra/ui-sdk/v1");
const inputHash = createHash("sha256");
const sourceHashes = {};
for (const path of ["sdk-filter-geometry.js", "sdk-filter-geometry.html", "sdk-components.js", "sdk-shell.js", "sdk.html", "sdk-build.mjs", "sdk-browser-matrix.mjs", "sdk-evidence.mjs", "sdk-theme.mjs", "package.json", resolve(sdk, "README.md"), resolve(sdk, "index.d.ts"), resolve(sdk, "shadow-overlays.d.mts"), resolve(sdk, "shadow-overlays.mjs"), resolve(sdk, "contract.json"), resolve(sdk, "probe-matrix.mjs"), resolve(sdk, "shadow-styles.mjs"), resolve(tree, "ui/src/extensions/runtime.ts")]) {
    const bytes = await readFile(path);
    inputHash.update(bytes);
    sourceHashes[path] = createHash("sha256").update(bytes).digest("hex");
}
const buildId = inputHash.digest("hex");
const {prepareShadowStyles} = await import(resolve(sdk, "shadow-styles.mjs"));
await build({configFile: false, plugins: [vue()], resolve: {dedupe: ["vue", "vue-router", "vue-i18n", "element-plus"], alias: {"@sdk": sdk, "@host-runtime": resolve(tree, "ui/src/extensions/runtime.ts")}},
    define: {"process.env.NODE_ENV": JSON.stringify("production"), __SDK_BUILD_ID__: JSON.stringify(buildId)},
    build: {outDir: "dist", cssCodeSplit: false, rollupOptions: {input: {sdk: "sdk.html", filterGeometry: "sdk-filter-geometry.html"}, output: {assetFileNames: asset => asset.names.some(name => name.endsWith(".css")) ? "sdk.css" : "assets/[name]-[hash][extname]"}}}});
const cssPath = "dist/sdk.css";
const css = await readFile(cssPath, "utf8");
const adapted = prepareShadowStyles(css, postcss);
await writeFile(cssPath, adapted + "\n:host{display:block;font-family:inherit}.extension-body{padding:var(--ks-spacing-5);color:var(--ks-text-primary);background:var(--ks-bg-base)}.extension-body output{display:block;overflow-wrap:anywhere}.probe-actions{display:flex;flex-wrap:wrap;gap:var(--ks-spacing-2)}[data-probe-portal]{font-family:inherit}\n");
const entry = await readFile("dist/sdk.html", "utf8");
const scripts = [...entry.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].map(match => match[0]);
const links = [...entry.matchAll(/<link[^>]*>/g)].map(match => match[0]).filter(value => !value.includes('rel="stylesheet"'));
await writeFile("dist/sdk.html", entry.replaceAll(/<link[^>]*rel="stylesheet"[^>]*>/g, ""));
await writeFile("dist/index.html", entry.replaceAll(/<link[^>]*rel="stylesheet"[^>]*>/g, ""));
await writeFile("dist/sdk-browser-matrix.mjs", await readFile("sdk-browser-matrix.mjs", "utf8"));
await writeFile("dist/sdk-evidence.mjs", await readFile("sdk-evidence.mjs", "utf8"));
await writeFile("dist/sdk-theme.mjs", await readFile("sdk-theme.mjs", "utf8"));
await writeFile("dist/build-evidence.json", JSON.stringify({candidateOnly: true, buildId, sourceHashes, tree, sdk, cssSha256: createHash("sha256").update(await readFile(cssPath)).digest("hex"), scriptTags: scripts, preloadTags: links}, null, 2));
