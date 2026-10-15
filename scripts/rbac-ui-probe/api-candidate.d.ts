export type Theme = "light" | "dark" | "dark-2";

export interface PageContextV1 {
    readonly version: 1;
    readonly tenant: string;
    readonly path: string;
    readonly locale: string;
    readonly supportedLocales: readonly string[];
    readonly theme: Theme;
    readonly themePreference: Theme | "system";
    readonly apiBase: string;
    readonly stylesheet: string;
    readonly signal: AbortSignal;
    navigate(relativePath: string, options?: {replace?: boolean}): Promise<void>;
    request(relativeApiPath: string, init?: RequestInit): Promise<Response>;
}

export interface MountedPageV1 {
    update(context: PageContextV1): Promise<void>;
    unmount(): void;
}

export interface PageModuleV1 {
    readonly contractVersion: 1;
    mount(container: HTMLElement, context: PageContextV1): Promise<MountedPageV1>;
}

export interface ManagementPageDescriptorV1 {
    readonly contractVersion: 1;
    readonly id: string;
    readonly entry: string;
    readonly styles: readonly string[];
    readonly files: Readonly<Record<string, {sha256: string; mime: string}>>;
    readonly title: Readonly<Record<string, string>>;
    readonly capabilityPath?: string;
}
