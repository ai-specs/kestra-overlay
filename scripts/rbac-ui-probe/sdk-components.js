import * as Vue from "vue";
import {createI18n} from "vue-i18n";
import {createMemoryHistory, createRouter} from "vue-router";
import {ElConfigProvider, ID_INJECTION_KEY} from "element-plus";
import * as Design from "@kestra-io/design-system";
import "@kestra-io/design-system/styleBase";
import {createShadowOverlayScope, createShadowRenderer, deepActiveElement, shadowOverlayComponents} from "@sdk/shadow-overlays.mjs";

export const contractVersion = 1;

export async function mount(container, context) {
    if (context.contractVersion !== 1 || context.signal.aborted) throw new Error("Unsupported probe context");
    const root = container.shadowRoot ?? container.attachShadow({mode: "open"});
    const content = document.createElement("div");
    content.className = "extension-body";
    const portal = document.createElement("div");
    portal.dataset.probePortal = "sdk";
    root.append(content, portal);
    const controller = new AbortController();
    const scope = createShadowOverlayScope({container, portal, content, signal: controller.signal, fallback: () => root.querySelector('[data-probe="title"]')});
    const raw = new URLSearchParams(location.search).has("raw");
    const originals = Object.fromEntries(["KsDrawer", "KsDialog", "KsSelect", "KsPopover", "KsTooltip", "KsDropdown", "KsDatePicker"].map(name => [name, Design[name]]));
    const components = raw ? originals : shadowOverlayComponents(Vue, originals, scope);
    const state = Vue.reactive({...context, opened: null, draft: "", initial: "", confirmation: false, saving: false, selected: ["first"], filters: [], guardCalls: 0});
    const rows = [{id: "one", kind: "first"}, {id: "two", kind: "second"}, {id: "three", kind: "first"}];
    const filteredRows = () => rows.filter(row => state.filters.filter(filter => filter.value != null && filter.value !== "" && (!Array.isArray(filter.value) || filter.value.length)).every(filter => filter.key === "kind" && filter.comparator === Design.Comparators.EQUALS
        && (Array.isArray(filter.value) ? filter.value.includes(row.kind) : filter.value === row.kind)));
    const i18n = createI18n({legacy: false, locale: state.locale, fallbackLocale: "en", messages: {}});
    await Design.registerDesignSystemI18n(i18n);
    const router = createRouter({history: createMemoryHistory(), routes: [{path: "/:pathMatch(.*)*", name: "probe", component: {render: () => null}}]});
    await router.push("/" + (state.fullPath ?? state.path));
    let synchronizing = false;
    let disposed = false;
    let hangGuard = false;
    let holdSave = false;
    let completeSave;
    const hiddenTrigger = Vue.ref(null);
    let pendingClose;
    let pendingNavigation;
    let saveTimer;
    const confirm = () => {state.confirmation = true;};
    const beforeClose = done => {
        if (state.saving) return;
        if (state.draft !== state.initial) {pendingClose = done; confirm();}
        else done();
    };
    const cancel = () => {state.confirmation = false; pendingClose = undefined; pendingNavigation?.(false); pendingNavigation = undefined;};
    const discard = () => {
        state.confirmation = false;
        state.draft = state.initial;
        pendingClose?.();
        pendingClose = undefined;
        pendingNavigation?.(true);
        pendingNavigation = undefined;
    };
    const button = (id, text, onClick, extra = {}) => Vue.h(Design.KsButton, {key: id, "data-probe": id, onClick, ...extra}, {default: () => text});
    const renderer = raw ? Vue : createShadowRenderer(Vue, scope, {idInjectionKey: ID_INJECTION_KEY, namespace: "kel"});
    const app = renderer.createApp({setup: () => () => Vue.h(ElConfigProvider, {namespace: "kel", locale: elementLocales[state.locale]}, {default: () => Vue.h("section", [
        Vue.h("h1", {tabindex: -1, "data-probe": "title"}, "Independent SDK probe"),
        Vue.h("output", {"data-probe": "context"}, state.fullPath ?? state.path),
        Vue.h("div", {class: "probe-actions"}, [0, 1, 2, 3].filter(index => index !== hiddenTrigger.value).map(index => button("open-" + index, "Drawer " + (index + 1), () => {state.opened = index; state.draft = state.initial; }))),
        Vue.h(Design.KsInput, {"data-probe": "inline-draft", "aria-label": "Inline draft", modelValue: state.draft, "onUpdate:modelValue": value => {state.draft = value;}}),
        Vue.h(Design.KsFilter, {configuration: {title: "Generic items", keys: [{key: "kind", label: "Kind", valueType: "select", comparators: [Design.Comparators.EQUALS], visibleByDefault: true, valueProvider: async () => [{label: "First", value: "first"}, {label: "Second", value: "second"}]}]},
            defaultScope: false, defaultTimeRange: false, buttons: {savedFilters: {shown: false}, tableOptions: {shown: false}},
            onFilter: values => {state.filters = values;}}),
        Vue.h("output", {"data-probe": "filter-result"}, JSON.stringify(state.filters)),
        Vue.h(Design.KsTable, {data: filteredRows(), "data-probe": "rows"}, {default: () => [Vue.h(Design.KsTableColumn, {prop: "id", label: "ID"}), Vue.h(Design.KsTableColumn, {prop: "kind", label: "Kind"})]}),
        ...[0, 1, 2, 3].map(index => Vue.h(components.KsDrawer, {
            key: index, modelValue: state.opened === index, "onUpdate:modelValue": value => {if (!value) state.opened = null;},
            title: "Generic editor " + (index + 1), class: "sm", size: "min(760px, 100vw)", appendTo: portal, appendToBody: false, lockScroll: false,
            beforeClose, destroyOnClose: true,
        }, {default: () => [
            Vue.h(Design.KsInput, {"data-probe": "draft", "aria-label": "Draft", modelValue: state.draft, "onUpdate:modelValue": value => {state.draft = value;}}),
            Vue.h(components.KsSelect, {"aria-label": "Generic choice", modelValue: state.selected, multiple: true, appendTo: portal, "onUpdate:modelValue": value => {state.selected = value;}}, {default: () => [Vue.h(Design.KsOption, {label: "First", value: "first"}), Vue.h(Design.KsOption, {label: "Second", value: "second"})]}),
            button("cancel", i18n.global.t("filter.cancel"), () => beforeClose(() => {state.opened = null;}), {disabled: state.saving}),
            button("save", i18n.global.t("filter.save"), () => {
                if (state.saving) return;
                state.saving = true;
                completeSave = () => {if (!state.saving || disposed) return; state.initial = state.draft; state.saving = false; state.opened = null; completeSave = undefined;};
                if (!holdSave) saveTimer = setTimeout(() => completeSave?.(), 1800);
            }, {disabled: state.saving}),
            Vue.h("output", {"data-probe": "saving"}, String(state.saving)),
        ]})),
        Vue.h(components.KsDialog, {modelValue: state.confirmation, "onUpdate:modelValue": value => {if (!value) cancel();}, title: "Discard draft?", width: "min(560px, calc(100vw - 32px))", appendTo: portal, appendToBody: false, lockScroll: false, closeOnClickModal: false, beforeClose: cancel}, {default: () => [
            button("keep", i18n.global.t("filter.cancel"), cancel), button("discard", i18n.global.t("filter.apply"), discard),
        ]}),
    ])})});
    for (const [name, component] of Object.entries(Design)) if (name.startsWith("Ks") && component && typeof component === "object") app.component(name, components[name] ?? component);
    app.use(i18n);
    app.use(router);
    const removeGuard = router.beforeEach(async to => {
        if (synchronizing) return true;
        try {await state.navigate(to.fullPath.slice(1)); return true;} catch {return false;}
    });
    const update = async next => {
        if (disposed) return;
        Object.assign(state, next);
        container.className = state.theme === "dark-2" ? "dark dark-2" : state.theme;
        content.lang = state.locale.replaceAll("_", "-");
        i18n.global.locale.value = state.locale;
        Design.setDesignSystemLocale(state.locale);
        synchronizing = true;
        try {await router.replace("/" + (state.fullPath ?? state.path));} finally {synchronizing = false;}
        await Vue.nextTick();
    };
    const unmount = () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(saveTimer);
        pendingNavigation?.(false);
        pendingNavigation = undefined;
        context.signal.removeEventListener("abort", unmount);
        removeGuard();
        app.unmount();
        controller.abort();
        root.replaceChildren();
    };
    try {
        await Promise.all(context.styles.map(url => new Promise((resolve, reject) => {
            const link = document.createElement("link");
            link.rel = "stylesheet"; link.href = url; link.onload = resolve; link.onerror = () => reject(new Error("Probe CSS failed")); root.prepend(link);
        })));
        await update(context);
        app.mount(content);
        context.signal.addEventListener("abort", unmount, {once: true});
        if (context.signal.aborted) unmount();
    } catch (error) {unmount(); throw error;}
    return {
        update, unmount,
        beforeNavigate() {
            state.guardCalls++;
            if (hangGuard) return new Promise(() => {});
            if (disposed || state.saving || pendingNavigation) return false;
            if (state.draft === state.initial) return true;
            confirm();
            return new Promise(resolve => {pendingNavigation = resolve;});
        },
        configure: async options => {if (typeof options.hangGuard === "boolean") hangGuard = options.hangGuard; if (typeof options.holdSave === "boolean") holdSave = options.holdSave; if (Number.isInteger(options.hideTrigger)) hiddenTrigger.value = options.hideTrigger; await Vue.nextTick();},
        completeSave: () => completeSave?.(),
        inspect: () => ({disposed, opened: state.opened, draft: state.draft, saved: state.initial, saving: state.saving, confirmation: state.confirmation,
            raw, overlay: scope.inspect(),
            selected: [...state.selected], filters: JSON.parse(JSON.stringify(state.filters)), guardCalls: state.guardCalls,
            rows: filteredRows().map(row => row.id),
            labels: {save: i18n.global.t("filter.save"), cancel: i18n.global.t("filter.cancel"), apply: i18n.global.t("filter.apply")},
            popupOpen: !!root.querySelector('[role="combobox"][aria-expanded="true"]'),
            focus: deepActiveElement()?.getAttribute("data-probe") ?? deepActiveElement()?.tagName, locale: state.locale, theme: state.theme, themePreference: state.themePreference,
            portalDialogs: portal.querySelectorAll('[role="dialog"]').length, documentDialogs: document.body.querySelectorAll('[role="dialog"]').length,
            bodyOverflow: document.body.style.overflow, fullPath: state.fullPath, query: state.query}),
    };
}

import en from "element-plus/es/locale/lang/en";
import de from "element-plus/es/locale/lang/de";
import es from "element-plus/es/locale/lang/es";
import fr from "element-plus/es/locale/lang/fr";
import hi from "element-plus/es/locale/lang/hi";
import it from "element-plus/es/locale/lang/it";
import ja from "element-plus/es/locale/lang/ja";
import ko from "element-plus/es/locale/lang/ko";
import pl from "element-plus/es/locale/lang/pl";
import pt from "element-plus/es/locale/lang/pt";
import pt_BR from "element-plus/es/locale/lang/pt-br";
import ru from "element-plus/es/locale/lang/ru";
import zh_CN from "element-plus/es/locale/lang/zh-cn";
const elementLocales = {en, de, es, fr, hi, it, ja, ko, pl, pt, pt_BR, ru, zh_CN};
