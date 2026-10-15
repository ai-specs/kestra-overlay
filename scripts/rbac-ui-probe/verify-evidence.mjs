import {readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
const root = fileURLToPath(new URL("../../.work/rbac-ui-probe/", import.meta.url));
const checks = [];
function check(name, passed, details) {
    checks.push({name, passed: Boolean(passed), details});
}
async function json(name) {
    return JSON.parse(await readFile(root + name, "utf8"));
}
try {
    const lifecycle = await json("browser-lifecycle.json");
    check("ESM lifecycle", lifecycle.duplicate === "ALREADY_MOUNTED" && lifecycle.disposed.children === 0 && lifecycle.disposed.dialogs === 0 && lifecycle.disposed.bodyClass === "", lifecycle);
    check("ESM context update", lifecycle.path === "main / roles/probe-role / fr / dark" && lifecycle.versions[2] === "UNSUPPORTED_CONTRACT", lifecycle.path);
    check("Owned popup and translated close", lifecycle.opened.dialogOwned && lifecycle.opened.close === "Fermer la boîte de dialogue", lifecycle.opened);
    const matrix = await json("language-matrix.json");
    const published = await json("published-language.json");
    check("13 published language resources rendered", matrix.length === 13 && matrix.every(row => row.text.includes(published.translations[row.locale].split("\n")[0])), matrix.map(row => row.locale));
    check("Observed untranslated pagination retained", matrix.every(row => row.pagination.includes("10 per page")), "Known gap; this check verifies evidence, not language acceptance");
    const host = await json("host-static-federation.json");
    check("Classpath JS executed", host.staticModule.text === "Static classpath probe module loaded", host.staticModule);
    check("No published management federation expose", host.federation.managementError.includes("does not exist"), host.federation);
    check("No extension menu in inspected host", !host.links.some(link => link.href.includes("extensions")), host.links);
    const missing = await json("missing-js.json");
    check("Missing JS SPA fallback retained", missing.status === 200 && missing.headers["content-type"].includes("text/html"), missing.headers);
    const route = await readFile(root + "host-route-with-jar.txt", "utf8");
    check("Mounted classpath jar does not register route", route.includes("Page not found"), "Browser route observation");
    const expectedModule = await readFile(new URL("static-probe.js", import.meta.url));
    const servedModule = await readFile(root + "classpath-module.js");
    check("Served JS content matches jar source", expectedModule.equals(servedModule), createHash("sha256").update(servedModule).digest("hex"));
    const ci = await json("published-ci.json");
    check("Published input CI successful", ci.conclusion === "success" && ci.headSha === "9a8dbdae8e13761e135f0e42ccd5ffe4a9635635", ci);
    const themes = await json("themes.json");
    check("Three resolved themes observed", themes.light.background === "rgb(247, 247, 248)" && themes.dark.background === "rgb(20, 24, 31)" && themes["dark-2"].background === "rgb(17, 17, 21)", themes);
} catch (error) {
    check("Evidence readable", false, String(error));
}
const report = {date: new Date().toISOString(), purpose: "Evidence consistency; does not accept production contract", checks, failed: checks.filter(item => !item.passed).length};
await writeFile(root + "evidence-check.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({checks: checks.length, failed: report.failed}));
process.exitCode = report.failed ? 1 : 0;
