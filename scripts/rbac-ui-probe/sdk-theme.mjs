export function contrastRatio(foreground, background) {
    const luminance = value => {
        const match = /^rgba?\(([^)]+)\)$/.exec(value);
        if (!match) throw new Error("Unsupported computed color: " + value);
        const channels = match[1].split(/[, /]+/).filter(Boolean).map(Number);
        if (channels.length > 3 && channels[3] !== 1) throw new Error("Theme contrast requires opaque colors");
        if (channels.length < 3 || channels.slice(0, 3).some(channel => !Number.isFinite(channel) || channel < 0 || channel > 255)) throw new Error("Invalid computed color");
        const linear = channels.slice(0, 3).map(channel => {const ratio = channel / 255; return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;});
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const first = luminance(foreground);
    const second = luminance(background);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function nativeThemeSettled(frame, theme) {
    const sample = frame.drawer?.nativeTheme;
    return !!sample && frame.theme === theme && frame.themePreference === "system" && frame.hostClass === theme
        && sample.backgroundToken.trim() !== "" && sample.textToken.trim() !== ""
        && sample.activeAnimations === 0
        && frame.drawer.style.background === sample.backgroundTarget
        && frame.drawer.style.color === sample.textTarget;
}

export function verifySystemThemePair(dark, light) {
    if (!nativeThemeSettled(dark, "dark") || !nativeThemeSettled(light, "light")) throw new Error("Native theme targets have not settled");
    if (dark.drawer.style.background === light.drawer.style.background) throw new Error("System change did not change actual drawer computed background");
    const contrast = {dark: contrastRatio(dark.drawer.style.color, dark.drawer.style.background), light: contrastRatio(light.drawer.style.color, light.drawer.style.background)};
    if (contrast.dark < 4.5 || contrast.light < 4.5) throw new Error("Native drawer text contrast is below 4.5:1");
    return contrast;
}
