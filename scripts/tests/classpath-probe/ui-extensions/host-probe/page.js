export const contractVersion = 1;
export function mount(container, context) {
    const root = container.attachShadow({mode: "open"});
    const content = document.createElement("section");
    content.setAttribute("aria-label", "Host extension probe");
    content.innerHTML = '<h1>Independent page probe</h1><output data-probe-context></output><button type="button">Open details</button>';
    root.append(content);
    const render = next => {
        content.querySelector("output").textContent = [next.path, next.locale, next.theme].join(" | ");
        content.style.color = next.theme === "light" ? "#14181f" : "#ffffff";
    };
    render(context);
    content.querySelector("button").addEventListener("click", () => context.navigate("details"));
    let closed = false;
    const unmount = () => {
        if (closed) return;
        closed = true;
        context.signal.removeEventListener("abort", unmount);
        root.replaceChildren();
    };
    context.signal.addEventListener("abort", unmount, {once: true});
    return {update: render, unmount};
}
