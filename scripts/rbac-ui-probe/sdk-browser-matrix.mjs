const locales = ["en", "de", "es", "fr", "hi", "it", "ja", "ko", "pl", "pt", "pt_BR", "ru", "zh_CN"];
const themes = ["light", "dark", "dark-2", "system"];
const widths = [1280, 768, 390];
const assert = (condition, message) => {if (!condition) throw new Error(message);};

function readFrame() {
    const state = window.sdkProbe?.inspect();
    if (!state) return {mounted: false};
    const host = document.querySelector("#extension");
    const root = host?.shadowRoot;
    const visible = node => node && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none";
    const rect = node => {const box = node.getBoundingClientRect(); return {left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height};};
    const style = node => {
        if (!node) return null;
        const value = getComputedStyle(node);
        return {color: value.color, background: value.backgroundColor, font: value.fontFamily, fontSize: value.fontSize, border: value.borderColor, padding: value.padding, radius: value.borderRadius};
    };
    const modals = root ? [...root.querySelectorAll('[role="dialog"]')].filter(visible) : [];
    const drawer = root?.querySelector(".kel-drawer.open");
    const dialog = root ? [...root.querySelectorAll(".kel-dialog")].find(visible) : null;
    const top = state.confirmation ? dialog : drawer ?? modals.at(-1);
    let focused = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    const controls = top ? [...top.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(node => visible(node) && !node.disabled && node.tabIndex >= 0 && !node.closest('[inert],[hidden],[aria-hidden="true"]')) : [];
    const choice = root ? [...root.querySelectorAll('.kel-select__wrapper')].filter(visible).at(-1) : null;
    const mobileToggle = root?.querySelector('.mobile-filter .mobile-toggle');
    const filterMode = visible(mobileToggle) ? "mobile" : visible(root?.querySelector('.chip.filter-chip')) ? "desktop" : "pending";
    const filter = filterMode === "mobile" ? root.querySelector('.mobile-bar') : root?.querySelector('.chip');
    const mobileSheet = root?.querySelector('.mobile-sheet');
    const nativeTheme = node => {
        const computed = getComputedStyle(node);
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;background-color:var(--kel-drawer-bg-color);color:var(--ks-text-primary);transition:none';
        node.append(probe);
        const resolved = getComputedStyle(probe);
        const targets = {backgroundTarget: resolved.backgroundColor, textTarget: resolved.color};
        probe.remove();
        return {...targets, backgroundToken: computed.getPropertyValue('--kel-drawer-bg-color'), textToken: computed.getPropertyValue('--ks-text-primary'),
            transitionProperty: computed.transitionProperty, transitionDuration: computed.transitionDuration,
            activeAnimations: node.getAnimations().filter(animation => animation.playState === 'running' || animation.pending).length};
    };
    const insidePortal = root ? [...root.querySelectorAll('[role="dialog"],[role="listbox"],.edit-overlay,.adv-overlay')].every(node => node.closest('[data-probe-portal="sdk"]')) : false;
    const text = selector => {const node = root?.querySelector(selector); return node?.textContent?.trim() ?? null;};
    return {...state, mounted: true, viewport: {width: innerWidth, height: innerHeight}, hostClass: host.className,
        rootLanguage: root?.querySelector('.extension-body')?.lang, owned: insidePortal,
        documentOverlays: document.querySelectorAll('[role="dialog"],[role="listbox"],.edit-overlay,.adv-overlay').length,
        documentWidth: document.documentElement.scrollWidth, focusedIndex: controls.indexOf(focused), controlCount: controls.length,
        focusedInTop: !!top?.contains(focused), focusedData: focused?.getAttribute('data-probe'),
        drawer: drawer && visible(drawer) ? {rect: rect(drawer), style: style(drawer), nativeTheme: nativeTheme(drawer), maximized: drawer.classList.contains('full-screen'),
            save: text('.kel-drawer.open [data-probe="save"]'), cancel: text('.kel-drawer.open [data-probe="cancel"]'),
            closeLabel: drawer.querySelector('.kel-drawer__close-btn')?.getAttribute('aria-label'),
            input: style(drawer.querySelector('input')), button: style(drawer.querySelector('[data-probe="save"]')), select: style(drawer.querySelector('.kel-select__wrapper'))} : null,
        dialog: dialog ? {rect: rect(dialog), style: style(dialog), keep: text('.kel-dialog [data-probe="keep"]'), discard: text('.kel-dialog [data-probe="discard"]')} : null,
        filter: filter ? {style: style(filter), rect: rect(filter)} : null, choice: choice ? rect(choice) : null,
        filterMode, filterSheet: visible(mobileSheet) ? {rect: rect(mobileSheet), style: style(mobileSheet)} : null,
        filterSelectVisible: !!root && [...root.querySelectorAll('.edit-popup .kel-select__wrapper,.mobile-sheet .kel-select__wrapper')].some(visible),
        locatorEvidence: root ? [...root.querySelectorAll('[data-probe],.chip.filter-chip,.mobile-toggle,.field-row-header')].map(node => ({tag: node.tagName, marker: node.getAttribute('data-probe'), class: node.className, label: node.getAttribute('aria-label'), visible: !!visible(node)})) : [],
        table: style(root?.querySelector('[data-probe="rows"]')), bodyOverflow: document.body.style.overflow,
    };
}

export async function runSdkBrowserMatrix(page, base = "http://127.0.0.1:5199", options = {}, record) {
    if (typeof options === "function") {record = options; options = {};}
    assert(typeof record === "function", "A persistent record(report) callback is required");
    for (const name of ["goto", "reload", "click", "fill", "press", "focus", "selectOption", "evaluate", "setViewport", "setColorScheme"]) assert(typeof page?.[name] === "function", "Existing common browser adapter missing " + name);
    const behaviorNames = ["canonical-query-refresh", "host-menu-dirty", "keyboard-host-dirty", "history-back-forward-dirty", "concurrent-navigation", "save-confinement", "focus-tab-loop", "maximize-reset", "focus-fallback", "dispose-pending-dirty", "dispose-uncooperative-guard", "public-safety-abort", "unmount-open-popup"];
    const expectedRows = themes.length * locales.length * widths.length * 6 + behaviorNames.length;
    const report = {candidateOnly: true, completed: false, expectedConfigurations: 156, expectedRows, rows: [], failures: 0, passed: 0, running: 0, notRun: expectedRows, diagnosticEventCount: 0, startedAt: new Date().toISOString()};
    const snapshot = () => page.evaluate(readFrame);
    const persist = () => record(JSON.parse(JSON.stringify(report)));
    const until = async (predicate, message) => {
        const deadline = Date.now() + (options.timeoutMs ?? 15000);
        let last;
        while (Date.now() < deadline) {
            last = await snapshot();
            if (predicate(last)) return last;
            await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error(message + "; last state=" + JSON.stringify(last));
    };
    const run = async (id, configuration, task) => {
        const row = {id, configuration, status: "running", startedAt: new Date().toISOString()};
        report.rows.push(row);
        report.running = 1;
        report.notRun = expectedRows - report.rows.length;
        await persist();
        let diagnosticBefore;
        try {
            if (typeof page.diagnostics === "function") diagnosticBefore = await page.diagnostics();
            row.evidence = await task();
            row.status = "passed";
        } catch (error) {
            row.status = "failed";
            row.error = String(error?.message ?? error);
            try {row.snapshot = await snapshot();} catch (snapshotError) {row.snapshotError = String(snapshotError);}
            const previousArtifacts = new Set((diagnosticBefore?.artifacts ?? []).map(artifact => artifact.path));
            const alreadyCaptured = typeof page.artifactReferences === "function" && page.artifactReferences().some(artifact => !previousArtifacts.has(artifact.path));
            if (!alreadyCaptured && typeof page.captureFailure === "function") try {await page.captureFailure(error, "sdk-" + id.replaceAll(/[^a-zA-Z0-9_-]/g, "-"));} catch (captureError) {row.captureError = String(captureError);}
        }
        if (diagnosticBefore) try {
            row.diagnostics = caseDiagnosticDelta(diagnosticBefore, await page.diagnostics());
            report.diagnosticEventCount += row.diagnostics.events.length;
            if (row.diagnostics.errorIds.length && row.status === "passed") {row.status = "failed"; row.error = "Browser errors require review: " + row.diagnostics.errorIds.join(", ");}
        } catch (diagnosticError) {row.status = "failed"; row.diagnosticError = String(diagnosticError);}
        if (row.status === "passed") report.passed++; else report.failures++;
        report.running = 0;
        row.finishedAt = new Date().toISOString();
        await persist();
    };
    const setup = async (configuration = {theme: "light", locale: "en", width: 1280}) => {
        await page.setViewport({width: configuration.width, height: 900});
        await page.setColorScheme("light");
        await page.goto(base + "/sdk/items");
        await until(value => value.mounted && !value.disposed && value.shadowNodes > 0, "Probe did not mount");
        await page.selectOption('[data-host="theme"]', configuration.theme);
        await page.selectOption('[data-host="locale"]', configuration.locale);
        const frame = await until(value => value.themePreference === configuration.theme && value.locale === configuration.locale && value.rootLanguage === configuration.locale.replaceAll("_", "-") && value.filterMode === (configuration.width <= 768 ? "mobile" : "desktop"), "Preference and native responsive filter update did not settle");
        assert(frame.raw === false, "Raw reproduction cannot run the candidate matrix");
        if (options.expectedBuildId) assert(frame.buildId === options.expectedBuildId, "Unexpected probe build: " + frame.buildId);
        assert(frame.errors.length === 0, "Probe lifecycle reported errors");
        return frame;
    };
    const invariants = frame => {
        assert(frame.documentOverlays === 0 && frame.owned, "An overlay escaped the extension portal");
        assert(JSON.stringify(frame.sentinelBefore) === JSON.stringify(frame.sentinelAfter), "Host sentinel computed styles changed");
        assert(frame.bodyOverflow === "", "Document scrolling was locked");
        assert(frame.errors.length === 0, "Probe lifecycle reported errors");
        assert(frame.documentWidth <= frame.viewport.width + 2, "Page overflows the requested viewport");
    };
    const open = async index => {
        await page.click(`[data-probe="open-${index}"]`);
        const frame = await until(value => value.opened === index && value.drawer?.rect.left >= -2 && value.drawer?.rect.right <= value.viewport.width + 2, "Drawer not stably interactive");
        invariants(frame);
        return frame;
    };
    const pressDraft = key => page.press('.kel-drawer.open input[data-probe="draft"]', key);
    const keep = async () => {await page.click('.kel-dialog [data-probe="keep"]'); return until(value => !value.confirmation && !value.dialog, "Discard cancel did not settle");};
    const discard = async () => {await page.click('.kel-dialog [data-probe="discard"]'); return until(value => !value.confirmation && !value.dialog, "Discard acceptance did not settle");};
    const openChoice = async () => {
        if (!(await snapshot()).popupOpen) await page.click('.kel-drawer.open .kel-select__wrapper');
        return until(value => value.popupOpen && value.overlay.popups.length > 0, "Select not logically open");
    };
    const closeChoice = async () => {
        await openChoice();
        await page.press('.kel-drawer.open .kel-select__wrapper', "Escape");
        const frame = await until(value => !value.popupOpen && value.overlay.popups.length === 0, "Select did not logically close");
        assert(frame.opened !== null && !frame.confirmation, "One Escape also reached the drawer");
        return frame;
    };
    const closeClean = async index => {
        await page.click('.kel-drawer.open [data-probe="cancel"]');
        return until(value => value.opened === null && value.focus === "open-" + index, "Drawer did not close and restore deep focus");
    };
    const navigate = async (requested, expectedCanonical = requested) => {await page.evaluate(value => window.sdkProbe.navigate(value), requested); return until(frame => frame.fullPath === expectedCanonical && frame.href === "/sdk/" + expectedCanonical, "Canonical extension location did not settle");};
    const settledSystemTheme = async theme => {
        let previous;
        let stable = 0;
        const samples = [];
        const frame = await until(value => {
            samples.push({theme: value.theme, hostClass: value.hostClass, style: value.drawer?.style, nativeTheme: value.drawer?.nativeTheme});
            if (samples.length > 12) samples.shift();
            const signature = JSON.stringify({theme: value.theme, hostClass: value.hostClass, style: value.drawer?.style, targets: value.drawer?.nativeTheme});
            stable = nativeThemeSettled(value, theme) && signature === previous ? stable + 1 : 0;
            previous = signature;
            return stable >= 2;
        }, "System " + theme + " native computed colors did not reach token targets and consecutive stable samples");
        return {frame, samples};
    };
    const inline = value => page.fill('input[data-probe="inline-draft"]', value);
    await persist();
    const baseCase = async (name, task) => run("behavior/" + name, null, async () => {await setup(); return task();});
    await baseCase("canonical-query-refresh", async () => {
        const requested = "items?key=a&key=b&flag&empty=&opaque=a%2Fb%23c";
        const expectedCanonical = "items?key=a&key=b&flag&empty=&opaque=a/b%23c";
        const frame = await navigate(requested, expectedCanonical);
        assert(JSON.stringify(frame.query) === JSON.stringify({key: ["a", "b"], flag: null, empty: "", opaque: "a/b#c"}), "Query values changed");
        await page.reload();
        const refreshed = await until(value => value.fullPath === expectedCanonical && value.href === "/sdk/" + expectedCanonical, "Direct refresh lost query");
        assert(JSON.stringify(refreshed.query) === JSON.stringify({key: ["a", "b"], flag: null, empty: "", opaque: "a/b#c"}), "Refreshed query values changed");
        return {frame, refreshed};
    });
    await baseCase("host-menu-dirty", async () => {
        await inline("menu-draft");
        const original = await snapshot();
        await page.click('[data-host="leave"]');
        await until(value => value.confirmation && value.dialog, "Host menu did not consult guard");
        const canceled = await keep();
        assert(canceled.fullPath === original.fullPath && canceled.href === original.href && canceled.draft === "menu-draft", "Host menu cancel changed route or draft");
        await page.click('[data-host="leave"]');
        await until(value => value.confirmation && value.dialog, "Accepted host leave confirmation missing");
        await discard();
        const accepted = await until(value => value.disposed && value.href === "/outside" && value.shadowNodes === 0, "Accepted host leave did not dispose");
        return {original, canceled, accepted};
    });
    await baseCase("keyboard-host-dirty", async () => {
        await open(0);
        await page.fill('.kel-drawer.open input[data-probe="draft"]', "shortcut-draft");
        await pressDraft("Alt+h");
        await until(value => value.confirmation && value.dialog, "Real host keyboard navigation did not consult guard");
        const frame = await keep();
        assert(frame.draft === "shortcut-draft" && frame.opened === 0 && frame.href === "/sdk/items", "Host shortcut cancel lost state");
        return frame;
    });
    await baseCase("history-back-forward-dirty", async () => {
        await navigate("first?key=one");
        await navigate("second?key=two");
        await inline("history-draft");
        await page.evaluate(() => history.back());
        await until(value => value.confirmation && value.dialog, "Back did not consult async guard");
        await keep();
        const backCanceled = await until(value => value.fullPath === "second?key=two" && value.href === "/sdk/second?key=two", "Canceled Back did not restore the address");
        assert(backCanceled.draft === "history-draft", "Canceled Back lost draft");
        await page.evaluate(() => history.back());
        await until(value => value.confirmation && value.dialog, "Second Back confirmation missing");
        await discard();
        await until(value => value.fullPath === "first?key=one" && value.href === "/sdk/first?key=one", "Accepted Back failed");
        await inline("forward-draft");
        await page.evaluate(() => history.forward());
        await until(value => value.confirmation && value.dialog, "Forward did not consult guard");
        await keep();
        const forwardCanceled = await until(value => value.fullPath === "first?key=one" && value.href === "/sdk/first?key=one", "Canceled Forward did not restore address");
        assert(forwardCanceled.draft === "forward-draft", "Canceled Forward lost draft");
        await page.evaluate(() => history.forward());
        await until(value => value.confirmation && value.dialog, "Second Forward confirmation missing");
        await discard();
        const accepted = await until(value => value.fullPath === "second?key=two" && value.href === "/sdk/second?key=two", "Accepted Forward failed");
        return {backCanceled, forwardCanceled, accepted};
    });
    await baseCase("concurrent-navigation", async () => {
        await inline("concurrent-draft");
        await page.evaluate(() => {window.sdkFirstNavigation = window.sdkProbe.navigate("pending").then(() => "allowed", () => "rejected");});
        await until(value => value.confirmation && value.dialog, "Pending guard missing");
        const second = await page.evaluate(() => window.sdkProbe.navigate("concurrent").then(() => "allowed", () => "rejected"));
        assert(second === "rejected", "Concurrent navigation was not rejected");
        await keep();
        const first = await page.evaluate(() => window.sdkFirstNavigation);
        assert(first === "rejected", "Canceled initial navigation did not reject");
        const frame = await until(value => value.href === "/sdk/items" && value.draft === "concurrent-draft", "Concurrent navigation changed the page");
        return {first, second, frame};
    });
    await baseCase("save-confinement", async () => {
        await navigate("before-save");
        await navigate("save");
        await open(1);
        await page.evaluate(() => window.sdkProbe.configure({holdSave: true}));
        await page.fill('.kel-drawer.open input[data-probe="draft"]', "saved-browser-value");
        await page.click('.kel-drawer.open [data-probe="save"]');
        await until(value => value.saving, "Save never entered pending state");
        await pressDraft("Escape");
        const beforeBack = await snapshot();
        await page.evaluate(() => history.back());
        const confined = await until(value => value.guardCalls > beforeBack.guardCalls && value.saving && value.href === "/sdk/save", "Save did not reject Back");
        assert(!confined.confirmation && confined.opened === 1, "Saving allowed close or discard");
        await page.evaluate(() => window.sdkProbe.completeSave());
        const saved = await until(value => !value.saving && value.saved === "saved-browser-value" && value.opened === null && value.focus === "open-1", "Save did not commit once and restore focus");
        return {confined, saved};
    });
    await baseCase("focus-tab-loop", async () => {
        await open(0);
        await page.focus('.kel-drawer.open [data-probe="save"]');
        await page.press('.kel-drawer.open [data-probe="save"]', "Tab");
        const first = await snapshot();
        assert(first.focusedIndex === 0, "Tab escaped the last control");
        await page.press('.kel-drawer.open .kel-drawer__header .kel-button', "Shift+Tab");
        const last = await snapshot();
        assert(last.focusedIndex === last.controlCount - 1, "Shift+Tab escaped the first control");
        return {first, last};
    });
    await baseCase("maximize-reset", async () => {
        const original = await open(0);
        await page.click('.kel-drawer.open .kel-drawer__header .kel-button');
        const maximized = await until(value => value.drawer?.maximized && Math.abs(value.drawer.rect.width - value.viewport.width * 0.99) <= 3, "Drawer did not reach the pinned native 99% fullscreen width");
        await closeClean(0);
        const reopened = await open(0);
        assert(!reopened.drawer.maximized && Math.abs(reopened.drawer.rect.width - original.drawer.rect.width) < 3, "Reopened drawer retained maximized state");
        return {original, maximized, reopened};
    });
    await baseCase("focus-fallback", async () => {
        await page.evaluate(() => {
            window.sdkOriginalTrigger = document.querySelector('#extension').shadowRoot.querySelector('[data-probe="open-0"]');
            if (!window.sdkOriginalTrigger?.isConnected) throw new Error("Original fallback-test trigger is unavailable");
        });
        await open(0);
        await page.evaluate(() => window.sdkProbe.configure({hideTrigger: 0}));
        const triggerIdentity = await page.evaluate(() => ({connected: window.sdkOriginalTrigger.isConnected, marker: window.sdkOriginalTrigger.dataset.probe,
            reusedAsNext: window.sdkOriginalTrigger === document.querySelector('#extension').shadowRoot.querySelector('[data-probe="open-1"]')}));
        assert(triggerIdentity.connected === false && triggerIdentity.reusedAsNext === false, "Fallback precondition failed: original trigger DOM was reused rather than removed");
        await page.click('.kel-drawer.open [data-probe="cancel"]');
        return {triggerIdentity, frame: await until(value => value.opened === null && value.focus === "title", "Removed trigger did not restore fallback focus")};
    });
    await baseCase("dispose-pending-dirty", async () => {
        await inline("abort-draft");
        await page.evaluate(() => {window.sdkPendingNavigation = window.sdkProbe.navigate("pending").then(() => "allowed", () => "rejected");});
        await until(value => value.confirmation && value.dialog, "Pending dirty guard missing");
        await page.evaluate(() => window.sdkProbe.unmount());
        const result = await page.evaluate(() => window.sdkPendingNavigation);
        assert(result === "rejected", "Safety disposal did not settle pending navigation");
        const frame = await until(value => value.disposed && value.shadowNodes === 0, "Safety disposal left live nodes");
        return {result, frame};
    });
    await baseCase("dispose-uncooperative-guard", async () => {
        await page.evaluate(() => window.sdkProbe.configure({hangGuard: true}));
        await page.evaluate(() => {window.sdkPendingNavigation = window.sdkProbe.navigate("never").then(() => "allowed", () => "rejected");});
        await until(value => value.guardCalls > 0, "Uncooperative guard never started");
        await page.evaluate(() => window.sdkProbe.unmount());
        const result = await page.evaluate(() => window.sdkPendingNavigation);
        assert(result === "rejected", "Uncooperative extension blocked abort");
        return {result, frame: await snapshot()};
    });
    await baseCase("public-safety-abort", async () => {
        await page.evaluate(() => window.sdkProbe.configure({hangGuard: true}));
        await page.evaluate(() => {window.sdkPendingNavigation = window.sdkProbe.navigate("never").then(() => "allowed", () => "rejected");});
        await until(value => value.guardCalls > 0, "Pending guard missing");
        await page.press('input[data-probe="inline-draft"]', "Alt+s");
        const frame = await until(value => value.disposed && value.href === "/public-safety" && value.shadowNodes === 0, "Public safety route was blocked");
        assert(await page.evaluate(() => window.sdkPendingNavigation) === "rejected", "Prior pending guard did not settle");
        return frame;
    });
    await baseCase("unmount-open-popup", async () => {
        await open(0);
        await openChoice();
        await page.evaluate(() => window.sdkProbe.unmount());
        const disposed = await until(value => value.disposed && value.shadowNodes === 0 && value.documentOverlays === 0, "Unmount left overlays");
        await page.press('body', "Escape");
        await page.click('[data-host="remount"]');
        const remounted = await until(value => !value.disposed && value.shadowNodes > 0 && value.opened === null, "Probe did not remount cleanly");
        invariants(remounted);
        return {disposed, remounted};
    });
    for (const theme of themes) for (const locale of locales) for (const width of widths) {
        const configuration = {theme, locale, width};
        const prefix = ["preferences", theme, locale, width].join("/");
        let prepared = false;
        const prepare = async () => {if (!prepared) {await setup(configuration); prepared = true;}};
        for (const index of [0, 1, 2, 3]) await run(prefix + "/drawer-" + index, configuration, async () => {
            await prepare();
            const frame = await open(index);
            assert(frame.drawer.save === frame.labels.save && frame.drawer.cancel === frame.labels.cancel, "Shared button translation does not match the selected public locale");
            assert(frame.labels.save && !frame.labels.save.startsWith("filter.") && frame.labels.cancel && !frame.labels.cancel.startsWith("filter."), "Shared translation is unresolved");
            assert(frame.drawer.closeLabel, "Drawer close button has no accessible name");
            assert(frame.drawer.rect.width <= Math.min(760, width) + 3, "Drawer does not fit the requested width");
            assert(frame.drawer.style.background !== "rgba(0, 0, 0, 0)", "Drawer background is transparent");
            await openChoice();
            const choice = await snapshot();
            invariants(choice);
            await closeChoice();
            let dialog;
            if (index === 0) {
                await page.fill('.kel-drawer.open input[data-probe="draft"]', "preference-draft");
                await pressDraft("Escape");
                dialog = await until(value => value.confirmation && value.dialog, "Dialog did not open");
                invariants(dialog);
                assert(dialog.dialog.keep === dialog.labels.cancel && dialog.dialog.discard === dialog.labels.apply, "Dialog button translation mismatch");
                assert(dialog.dialog.rect.left >= -2 && dialog.dialog.rect.right <= width + 2, "Dialog overflows narrow viewport");
                const retained = await keep();
                assert(retained.draft === "preference-draft" && retained.opened === index, "Cancel lost the draft");
                await pressDraft("Escape");
                await until(value => value.confirmation && value.dialog, "Second discard confirmation missing");
                await discard();
                await until(value => value.opened === null && value.focus === "open-0", "Discard did not close and restore focus");
            } else await closeClean(index);
            return {frame, choice, dialog, after: await snapshot()};
        }).then(() => {if (report.rows.at(-1).status === "failed") prepared = false;});
        await run(prefix + "/native-filter", configuration, async () => {
            await prepare();
            const mobile = (await snapshot()).filterMode === "mobile";
            if (mobile) {
                await page.click('.mobile-filter .mobile-toggle');
                await until(value => value.filterSheet && value.overlay.modals.length > 0, "Native mobile filter did not mount in the portal");
                await page.click('.mobile-sheet .field-row-header');
            } else await page.click('.chip.filter-chip');
            await until(value => value.overlay.modals.length > 0, "Native filter did not mount in the owned portal");
            await until(value => value.filterSelectVisible, "Native filter value control is not interactive");
            const select = mobile ? '.mobile-sheet .kel-select__wrapper' : '.edit-popup .kel-select__wrapper';
            await page.click(select);
            await until(value => value.popupOpen, "Native filter select is not logically open");
            await page.click('[role="option"]:text-is("Second")');
            const filtered = await until(value => value.rows?.length === 1 && value.rows[0] === "two" && Object.keys(value.query ?? {}).some(key => key.startsWith("filters[")), "Filter results and host query did not agree");
            invariants(filtered);
            if (filtered.popupOpen) await page.press(select, "Escape");
            await page.click(mobile ? '.mobile-sheet .sheet-apply' : '.edit-popup .filter-header-trailing > button');
            await until(value => value.overlay.modals.length === 0 && !value.popupOpen, "Filter did not close");
            await page.reload();
            const refreshed = await until(value => value.mounted && value.rows?.length === 1 && value.rows[0] === "two", "Filter did not survive the canonical URL refresh");
            invariants(refreshed);
            if (mobile) {
                await page.click('.mobile-filter .mobile-toggle');
                await until(value => value.filterSheet && value.overlay.modals.length > 0, "Mobile clear panel did not open");
                await page.click('.mobile-sheet .sheet-clear');
            } else await page.click('.chip.filter-chip > button.close');
            const cleared = await until(value => value.rows?.length === 3 && !Object.keys(value.query ?? {}).some(key => key.startsWith("filters[")), "Removing the native filter did not clear rows and URL");
            if (mobile) {
                await page.click('.mobile-sheet .sheet-apply');
                await until(value => !value.filterSheet && value.overlay.modals.length === 0, "Mobile filter did not finish closing");
            }
            return {filtered, refreshed, cleared};
        });
        if (report.rows.at(-1).status === "failed") prepared = false;
        await run(prefix + "/refresh-and-system", configuration, async () => {
            await prepare();
            await page.reload();
            const refreshed = await until(value => value.mounted && !value.disposed && value.locale === locale && value.themePreference === theme, "Probe preference bridge did not survive reload");
            invariants(refreshed);
            const samples = [refreshed];
            if (theme === "system") {
                await page.setColorScheme("dark");
                samples.push(await until(value => value.theme === "dark", "System dark preference did not update"));
                await open(0);
                const darkSample = await settledSystemTheme("dark");
                const dark = darkSample.frame;
                await page.setColorScheme("light");
                const lightSample = await settledSystemTheme("light");
                const light = lightSample.frame;
                const contrast = verifySystemThemePair(dark, light);
                invariants(light);
                samples.push({dark, light, contrast, transitionSamples: {dark: darkSample.samples, light: lightSample.samples}});
                await closeClean(0);
            }
            return {probeBridgeOnly: true, productionHostPreferencesNotProven: true, samples};
        });
    }
    report.completed = report.rows.length === expectedRows && report.rows.every(row => ["passed", "failed"].includes(row.status));
    report.finishedAt = new Date().toISOString();
    report.passedGate = report.completed && report.failures === 0 && report.notRun === 0;
    await persist();
    return report;
}

export const sdkBrowserMatrix = Object.freeze({locales, themes, widths, configurations: 156, independentProbeOnly: true});
import {caseDiagnosticDelta} from "./sdk-evidence.mjs";
import {nativeThemeSettled, verifySystemThemePair} from "./sdk-theme.mjs";
