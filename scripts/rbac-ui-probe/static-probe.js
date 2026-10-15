export const contractVersion = 1;
export function mount(container) {
    container.textContent = "Static classpath probe module loaded";
    return {update() {}, unmount() {container.replaceChildren();}};
}
