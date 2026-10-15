import {createApp, h, reactive, ref, nextTick} from "vue";
import {createI18n} from "vue-i18n";
import {ElConfigProvider} from "element-plus";
import en from "element-plus/es/locale/lang/en";
import fr from "element-plus/es/locale/lang/fr";
import KsButton from "@kestra-io/design-system/components/Basic/KsButton/KsButton";
import KsInput from "@kestra-io/design-system/components/Form/KsInput";
import KsDialog from "@kestra-io/design-system/components/Feedback/KsDialog";
import KsPagination from "@kestra-io/design-system/components/Data/KsPagination";
import KsSelect from "@kestra-io/design-system/components/Form/KsSelect/KsSelect";
import KsOption from "@kestra-io/design-system/components/Form/KsSelect/KsOption";
import "@kestra-io/design-system/styleBase";
import "./probe.css";

export const contractVersion = 1;
const mounts = new WeakMap();
export async function mount(container, context) {
    if (mounts.has(container)) throw new Error("ALREADY_MOUNTED");
    if (context.version !== contractVersion) throw new Error("UNSUPPORTED_CONTRACT");
    if (context.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const state = reactive({...context});
    const popupRoot = document.createElement("div");
    popupRoot.className = "probe-popups";
    container.append(popupRoot);
    const appRoot = document.createElement("div");
    container.append(appRoot);
    const i18n = createI18n({legacy: false, locale: state.locale, fallbackLocale: "en", messages: {en: {}, fr: {}}});
    const app = createApp({setup() {
        const opened = ref(false);
        const name = ref("probe-role");
        const selection = ref("read");
        return () => h(ElConfigProvider, {namespace: "kel", locale: state.locale === "fr" ? fr : en}, {default: () => [
            h("section", {class: "probe-page", "data-locale": state.locale, "data-theme": state.theme}, [
                h("h1", "Independent role page probe"),
                h("p", `${state.tenant} / ${state.path} / ${state.locale} / ${state.theme}`),
                h("label", ["Name", h(KsInput, {modelValue: name.value, "onUpdate:modelValue": value => name.value = value})]),
                h(KsSelect, {modelValue: selection.value, "onUpdate:modelValue": value => selection.value = value, appendTo: popupRoot}, {default: () => [h(KsOption, {label: "READ", value: "read"}), h(KsOption, {label: "WRITE", value: "write"})]}),
                h(KsButton, {type: "primary", onClick: () => opened.value = true}, {default: () => "Open dialog"}),
                h(KsButton, {onClick: () => state.navigate("roles/probe-role")}, {default: () => "Details"}),
                h(KsPagination, {total: 42, pageSize: 10, currentPage: 1, layout: "total, sizes, prev, pager, next"}),
                h(KsDialog, {modelValue: opened.value, "onUpdate:modelValue": value => opened.value = value, title: "Probe dialog", appendTo: popupRoot, appendToBody: true, width: "80%"}, {default: () => h("p", "Owned overlay; close or unmount")})
            ])
        ]});
    }});
    app.use(i18n);
    app.mount(appRoot);
    let disposed = false;
    function unmount() {
        if (disposed) return;
        disposed = true;
        context.signal.removeEventListener("abort", unmount);
        app.unmount();
        appRoot.remove();
        popupRoot.remove();
        mounts.delete(container);
    }
    context.signal.addEventListener("abort", unmount, {once: true});
    mounts.set(container, true);
    await nextTick();
    return {async update(next) {
        if (disposed) throw new Error("DISPOSED");
        if (next.version !== contractVersion) throw new Error("UNSUPPORTED_CONTRACT");
        Object.assign(state, next);
        i18n.global.locale.value = next.locale;
        await nextTick();
    }, unmount};
}
