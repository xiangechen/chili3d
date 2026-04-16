// Bridge to the parent window's chili3d app. The chat UI is loaded inside a
// same-origin iframe, so we reach the live Application instance and the node
// constructors (BoxNode, SphereNode, ...) through window.parent. Keeping all
// node construction in the parent realm avoids cross-realm issues with
// serialization and instanceof checks.

import type { IApplication } from "@chili3d/core";

type ChiliCoreModule = typeof import("@chili3d/core");
type ChiliAppModule = typeof import("@chili3d/app");

interface ParentGlobals {
    chili3dApp?: IApplication;
    Chili3dCore?: ChiliCoreModule;
    Chili3dApp?: ChiliAppModule;
}

function parentWindow(): Window & ParentGlobals {
    if (typeof window === "undefined" || window.parent == null) {
        throw new Error("chili3d-ai: no parent window");
    }
    return window.parent as Window & ParentGlobals;
}

export function getApplication(): IApplication {
    const app = parentWindow().chili3dApp;
    if (!app) {
        throw new Error(
            "chili3d-ai: parent has not exposed chili3dApp yet. Ensure AppBuilder.build() has completed.",
        );
    }
    return app;
}

export function getCore(): ChiliCoreModule {
    const mod = parentWindow().Chili3dCore;
    if (!mod) throw new Error("chili3d-ai: parent missing Chili3dCore module");
    return mod;
}

export function getAppModule(): ChiliAppModule {
    const mod = parentWindow().Chili3dApp;
    if (!mod) throw new Error("chili3d-ai: parent missing Chili3dApp module");
    return mod;
}

export function requireActiveDocument() {
    const app = getApplication();
    const doc = app.activeView?.document;
    if (!doc) throw new Error("No active document. Call new_document or open_document first.");
    return doc;
}
