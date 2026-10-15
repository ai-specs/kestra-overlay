import {createApp, h, reactive, ref, nextTick} from "vue";
import {createI18n} from "vue-i18n";
import {ElConfigProvider} from "element-plus";
import KsButton from "@kestra-io/design-system/components/Basic/KsButton/KsButton";
import KsInput from "@kestra-io/design-system/components/Form/KsInput";
import KsTable from "@kestra-io/design-system/components/Data/KsTable/KsTable";
import KsTableColumn from "@kestra-io/design-system/components/Data/KsTable/KsTableColumn";
import "@kestra-io/design-system/styleBase";
export const contractVersion = 1;
export async function mount(container, context) {
    if (context.version !== 1) throw new Error("UNSUPPORTED_CONTRACT");
    const shadow = container.shadowRoot ?? container.attachShadow({mode: "open"});
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = context.stylesheet ?? "/phase1/shadow.css";
    const loaded = new Promise((resolve, reject) => {stylesheet.onload = resolve; stylesheet.onerror = reject;});
    shadow.append(stylesheet);
    const body = document.createElement("div");
    body.className = "shadow-body";
    shadow.append(body);
    const state = reactive({...context});
    const i18n = createI18n({legacy: false, locale: state.locale, fallbackLocale: "en", messages: {en: {page: "Page {page} of {total}"}, fr: {page: "Page {page} sur {total}"}, zh_CN: {page: "第 {page} 页，共 {total} 页"}}});
    const app = createApp({setup() {
        const name = ref("probe-role");
        const description = ref("Probe description");
        const page = ref(1);
        const confirm = ref(false);
        return () => h(ElConfigProvider, {namespace: "kel"}, {default: () => h("section", {class: "probe-page"}, [
            h("h1", "Phase 1 management probe"),
            h("p", `${state.locale} / ${state.theme} / ${state.themePreference}`),
            h("label", {for: "probe-name"}, "Name"),
            h(KsInput, {id: "probe-name", modelValue: name.value, "onUpdate:modelValue": value => name.value = value}),
            h("label", {for: "probe-description"}, "Description"),
            h(KsInput, {id: "probe-description", modelValue: description.value, "onUpdate:modelValue": value => description.value = value}),
            h(KsButton, {type: "primary", onClick: () => state.navigate?.("roles/probe-role")}, {default: () => "Details"}),
            h(KsButton, {onClick: () => confirm.value = !confirm.value}, {default: () => "Delete"}),
            confirm.value ? h("p", {role: "status"}, "Confirm deletion on this page") : null,
            h(KsTable, {data: [{name: "probe-role", scope: "team.a"}]}, {default: () => [h(KsTableColumn, {prop: "name", label: "Name"}), h(KsTableColumn, {prop: "scope", label: "Scope"})]}),
            h("nav", {"aria-label": "Pagination"}, [h("span", {class: "page-label"}, i18n.global.t("page", {page: page.value, total: 2})), h(KsButton, {onClick: () => page.value = page.value === 1 ? 2 : 1}, {default: () => "Next page"})])
        ])});
    }});
    app.use(i18n);
    const update = async next => {
        container.className = next.theme === "dark-2" ? "dark dark-2" : next.theme;
        Object.assign(state, next);
        i18n.global.locale.value = next.locale;
        await nextTick();
    };
    await update(context);
    await loaded;
    app.mount(body);
    let disposed = false;
    const unmount = () => {
        if (disposed) return;
        disposed = true;
        context.signal.removeEventListener("abort", unmount);
        app.unmount();
        shadow.replaceChildren();
    };
    context.signal.addEventListener("abort", unmount, {once: true});
    return {update, unmount};
}
