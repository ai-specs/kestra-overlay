import {createApp, h, reactive, ref, nextTick, watch} from "vue";
import {createI18n} from "vue-i18n";
import {ElConfigProvider, ElPopover} from "element-plus";
import en from "element-plus/es/locale/lang/en";
import fr from "element-plus/es/locale/lang/fr";
import {KsButton, KsInput, KsDialog, KsPagination, KsEmpty, registerDesignSystemI18n, setDesignSystemLocale} from "@kestra-io/design-system";
import "@kestra-io/design-system/styleBase";
export const contractVersion = 1;
export async function mount(container, context) {
    if (context.version !== 1) throw new Error("UNSUPPORTED_CONTRACT");
    const shadow = container.shadowRoot ?? container.attachShadow({mode: "open"});
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = context.stylesheet ?? "/shadow/shadow.css";
    const loaded = new Promise((resolve, reject) => {stylesheet.onload = resolve; stylesheet.onerror = reject;});
    shadow.append(stylesheet);
    const body = document.createElement("div");
    body.className = "shadow-body";
    const popup = document.createElement("div");
    popup.className = "owned-popups";
    const target = document.createElement("div");
    body.append(target, popup);
    shadow.append(body);
    const state = reactive({...context});
    const i18n = createI18n({legacy: false, locale: context.locale, fallbackLocale: "en", messages: {}});
    await registerDesignSystemI18n(i18n);
    setDesignSystemLocale(context.locale);
    const app = createApp({setup() {
        const opened = ref(false);
        const value = ref("probe-role");
        let opener;
        watch(opened, async next => {
            if (next) {
                opener = shadow.activeElement;
                await nextTick();
                popup.querySelector("input")?.focus();
            } else {
                await nextTick();
                opener?.focus();
            }
        });
        const trapFocus = event => {
            if (!opened.value) return;
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                opened.value = false;
            }
            if (event.key !== "Tab") return;
            const dialog = popup.querySelector("[role=dialog]");
            const elements = [...dialog.querySelectorAll("button:not([disabled]),input:not([disabled]),[tabindex='0']")].filter(node => node.getBoundingClientRect().width > 0);
            const current = elements.indexOf(shadow.activeElement);
            const next = (current + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
            event.preventDefault();
            event.stopImmediatePropagation();
            elements[next]?.focus();
        };
        shadow.addEventListener("keydown", trapFocus, true);
        removeFocusHandler = () => shadow.removeEventListener("keydown", trapFocus, true);
        return () => h(ElConfigProvider, {namespace: "kel", locale: state.locale === "fr" ? fr : en}, {default: () => h("section", {class: "probe-page"}, [
            h("h1", "Shadow management probe"),
            h("p", `${state.locale} / ${state.theme} / ${state.themePreference}`),
            h("label", ["Name", h(KsInput, {modelValue: value.value, "onUpdate:modelValue": next => value.value = next})]),
            h(KsButton, {type: "primary", onClick: () => opened.value = true}, {default: () => "Open shadow dialog"}),
            h(ElPopover, {trigger: "click", content: "Owned shadow popover", appendTo: popup}, {reference: () => h(KsButton, {}, {default: () => "Open shadow popover"})}),
            h(KsEmpty),
            h(KsPagination, {total: 42, currentPage: 1, pageSize: 10, layout: "total, sizes, prev, pager, next"}),
            h(KsDialog, {modelValue: opened.value, "onUpdate:modelValue": next => opened.value = next, title: "Shadow dialog", appendTo: popup, appendToBody: true, lockScroll: false, width: "min(90vw, 600px)"}, {default: () => h(KsInput, {placeholder: "Dialog focus target"})})
        ])});
    }});
    let removeFocusHandler = () => {};
    app.use(i18n);
    const apply = next => {
        container.className = next.theme === "dark-2" ? "dark dark-2" : next.theme;
        Object.assign(state, next);
        i18n.global.locale.value = next.locale;
        setDesignSystemLocale(next.locale);
    };
    apply(context);
    await loaded;
    app.mount(target);
    let disposed = false;
    const unmount = () => {
        if (disposed) return;
        disposed = true;
        context.signal.removeEventListener("abort", unmount);
        removeFocusHandler();
        app.unmount();
        shadow.replaceChildren();
    };
    context.signal.addEventListener("abort", unmount, {once: true});
    return {async update(next) {apply(next); await nextTick();}, unmount};
}
