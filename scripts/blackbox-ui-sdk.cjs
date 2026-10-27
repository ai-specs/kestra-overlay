const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {createHash} = require("node:crypto");
const {createDiagnostics} = require("./sdk-browser-diagnostics.cjs");

function createStaticServer(directory) {
    const root = path.resolve(directory);
    const types = {".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2"};
    return http.createServer(async (request, response) => {
        try {
            if (!["GET", "HEAD"].includes(request.method)) {response.writeHead(405).end(); return;}
            const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
            if (pathname === "/favicon.ico") {response.writeHead(204).end(); return;}
            let filename = path.resolve(root, "." + pathname);
            if (filename !== root && !filename.startsWith(root + path.sep)) {response.writeHead(403).end(); return;}
            const info = await fs.stat(filename).catch(() => null);
            if (info?.isDirectory() || !info && !path.extname(filename)) filename = path.join(root, "index.html");
            const content = await fs.readFile(filename).catch(() => null);
            if (content === null) {response.writeHead(404).end(); return;}
            response.writeHead(200, {"Content-Type": types[path.extname(filename)] ?? "application/octet-stream", "Cache-Control": "no-store"});
            response.end(request.method === "HEAD" ? undefined : content);
        } catch (error) {
            response.writeHead(400).end();
        }
    });
}

function createAdapter(page, diagnostics, failureDirectory) {
    const target = selector => {
        const exactText = selector.match(/^(.*):text-is\(("(?:[^"\\]|\\.)*")\)$/);
        if (!exactText) return page.locator(selector);
        const text = JSON.parse(exactText[2]).trim().split(/\s+/).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
        return page.locator(exactText[1]).filter({visible: true, hasText: new RegExp("^\\s*" + text + "\\s*$")});
    };
    return {
        goto: url => page.goto(url, {waitUntil: "domcontentloaded"}),
        reload: () => page.reload({waitUntil: "domcontentloaded"}),
        click: selector => target(selector).click(),
        fill: (selector, value) => target(selector).fill(value),
        press: (selector, key) => target(selector).press(key),
        focus: selector => target(selector).focus(),
        selectOption: (selector, value) => target(selector).selectOption(value),
        evaluate: (callback, argument) => page.evaluate(callback, argument),
        setViewport: viewport => page.setViewportSize(viewport),
        setColorScheme: colorScheme => page.emulateMedia({colorScheme}),
        diagnostics: () => diagnostics.snapshot(),
        artifactReferences: () => diagnostics.artifactReferences(),
        captureFailure: async (error, name) => {
            await fs.mkdir(failureDirectory, {recursive: true});
            const filename = path.join(failureDirectory, name.replaceAll(/[^a-zA-Z0-9_-]/g, "-") + ".png");
            const source = diagnostics.currentDocument();
            await page.screenshot({path: filename, fullPage: true});
            diagnostics.artifact(filename, source);
        },
    };
}

function validateReport(report) {
    if (!report.completed || !report.passedGate || report.expectedRows !== 949 || report.rows?.length !== 949
        || report.passed !== 949 || report.failures !== 0 || report.notRun !== 0
        || report.rows.some(row => row.status !== "passed")) throw new Error("SDK browser matrix requires all949 rows without failures or unrun checks");
}

async function main() {
    const output = path.resolve(process.env.UI_SDK_BROWSER_REPORT ?? ".work/ui-sdk-browser.json");
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.rename(output, output + ".previous-" + Date.now()).catch(error => {if (error.code !== "ENOENT") throw error;});
    await fs.writeFile(output, JSON.stringify({completed: false, passedGate: false, expectedRows: 949, rows: [], notRun: 949, phase: "bootstrap"}));
    const directory = path.resolve(process.env.UI_SDK_PROBE_DIR ?? "");
    if (!process.env.UI_SDK_PROBE_DIR) throw new Error("UI_SDK_PROBE_DIR is required");
    const failures = path.resolve(process.env.UI_SDK_BROWSER_FAILURES ?? ".work/ui-sdk-browser-failures");
    const build = JSON.parse(await fs.readFile(path.join(directory, "build-evidence.json"), "utf8"));
    if (!/^[a-f0-9]{64}$/.test(build.buildId)) throw new Error("Probe source buildId is missing or invalid");
    const modulePath = path.join(directory, "sdk-browser-matrix.mjs");
    const matrixSha256 = createHash("sha256").update(await fs.readFile(modulePath)).digest("hex");
    const sourceSha256 = {};
    for (const filename of [__filename, path.join(__dirname, "sdk-browser-diagnostics.cjs"), modulePath,
        path.join(directory, "sdk-theme.mjs"), path.join(directory, "sdk-evidence.mjs")])
        sourceSha256[filename] = createHash("sha256").update(await fs.readFile(filename)).digest("hex");
    let diagnostics;
    let lastReport = {completed: false, rows: []};
    let browser;
    const persist = async report => {
        lastReport = report;
        await fs.mkdir(path.dirname(output), {recursive: true});
        await fs.writeFile(output + ".tmp", JSON.stringify({...report, build, matrixSha256, sourceSha256, candidateImage: process.env.CANDIDATE_IMAGE ?? null,
            diagnostics: diagnostics ? await diagnostics.snapshot() : null}));
        await fs.rename(output + ".tmp", output);
    };
    const server = createStaticServer(directory);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const {chromium} = require("playwright");
        browser = await chromium.launch({headless: true});
        const context = await browser.newContext();
        const page = await context.newPage();
        diagnostics = createDiagnostics(await context.newCDPSession(page));
        await diagnostics.attach();
        const {runSdkBrowserMatrix} = await import(pathToFileURL(modulePath).href);
        const report = await runSdkBrowserMatrix(createAdapter(page, diagnostics, failures), `http://127.0.0.1:${server.address().port}`, {expectedBuildId: build.buildId, timeoutMs: 15000}, persist);
        for (const [filename, expected] of Object.entries(sourceSha256))
            if (createHash("sha256").update(await fs.readFile(filename)).digest("hex") !== expected) throw new Error("Browser input changed during execution: " + filename);
        validateReport(report);
        const finalDiagnostics = await diagnostics.snapshot();
        if (finalDiagnostics.events.some(event => ["console-error", "page-error", "http-error", "request-failed", "diagnostic-integrity-error"].includes(event.kind)))
            throw new Error("SDK browser recorded source-associated diagnostic errors");
        await persist({...report, driverPassed: true, playwrightVersion: require("playwright/package.json").version, browserVersion: browser.version()});
        console.log("SDK BROWSER MATRIX GREEN:949/949; buildId=" + build.buildId);
    } catch (error) {
        await persist({...lastReport, matrixPassedGate: lastReport.passedGate, passedGate: false, driverPassed: false, driverFailure: String(error?.stack ?? error)});
        throw error;
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

module.exports = {createStaticServer, createAdapter, validateReport};
if (require.main === module) main().catch(async error => {
    const output = path.resolve(process.env.UI_SDK_BROWSER_REPORT ?? ".work/ui-sdk-browser.json");
    const report = JSON.parse(await fs.readFile(output, "utf8").catch(() => "{}"));
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(output, JSON.stringify({...report, passedGate: false, driverPassed: false, driverFailure: String(error?.stack ?? error)}));
    console.error(error.stack ?? error); process.exitCode = 1;
});
