// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IView } from "@chili3d/core";
import { afterEach, describe, expect, rs, test } from "@rstest/core";

rs.mock("../src/viewport/viewport.module.css", () => ({
    root: "vp-root",
    actsContainer: "vp-acts-container",
    border: "vp-border",
    acts: "vp-acts",
    tools: "vp-tools",
    viewControls: "vp-view-controls",
    viewModeControl: "vp-view-mode-control",
    viewModeDisplay: "vp-view-mode-display",
    viewModeMenu: "vp-view-mode-menu",
    visible: "vp-visible",
    actived: "vp-actived",
}));

// Track PubSub publications via the shared recorder
const pubSubRecorder = rs.hoisted(() => {
    const { createPubSubRecorder } = require("./_helpers/coreMocks");
    return createPubSubRecorder();
});

// Mock core — the hoisted `actual` snapshots core mid-initialization, so every
// runtime value the Viewport touches (PubSub, Binding, ViewModes, ...) is stubbed.
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { BindingMock, LocalizeMock } = rs.hoisted(() => require("./_helpers/coreMocks"));
    return {
        ...actual,
        Binding: BindingMock,
        Localize: LocalizeMock,
        I18n: {
            set: (dom: HTMLElement, path: string, key: string) => {
                if (path === "title") dom.setAttribute("title", key);
                else dom.textContent = key;
            },
            translate: (key: string) => key,
        },
        PubSub: pubSubRecorder.stub,
        Result: { ok: (value: unknown) => ({ isOk: true, value }) },
        ViewModes: [],
        ViewModeI18nKeys: {},
    };
});

// Mock element helpers
import "./_helpers/mockElement";

// The real Flyout drags in the Input/Tip chain; a detached div is enough here.
rs.mock("../src/viewport/flyout", () => ({
    Flyout: function Flyout() {
        return document.createElement("div");
    },
}));

import { Viewport } from "../src/viewport/viewport";

function createMockView(
    detected: unknown[],
    node: unknown,
    eventHandler: { isEnabled: boolean; doubleClick?: (view: unknown, event: MouseEvent) => void } = {
        isEnabled: true,
    },
) {
    const doc = {
        acts: {
            length: 0,
            forEach: () => {},
            onCollectionChanged: rs.fn(),
            removeCollectionChanged: rs.fn(),
        },
        visual: { context: { getNode: rs.fn(() => node) }, eventHandler },
        application: { activeView: undefined },
    };
    const view = {
        document: doc,
        mode: "perspective",
        cameraController: {},
        setDom: rs.fn(),
        update: rs.fn(),
        detectVisual: rs.fn(() => detected),
        onPropertyChanged: rs.fn(),
        removePropertyChanged: rs.fn(),
    };
    return { doc, view };
}

function dispatchDoubleClick(target: HTMLElement, offsetX: number, offsetY: number) {
    const event = new MouseEvent("dblclick", { bubbles: true });
    Object.defineProperties(event, { offsetX: { value: offsetX }, offsetY: { value: offsetY } });
    target.dispatchEvent(event);
}

describe("Viewport double-click", () => {
    let viewport: Viewport | undefined;

    afterEach(() => {
        viewport?.remove();
        viewport = undefined;
        pubSubRecorder.reset();
    });

    test("should publish nodeDoubleClicked for the node under the cursor", () => {
        const visual = { id: "visual-1" };
        const node = { name: "node-1" };
        const { doc, view } = createMockView([visual], node);
        viewport = new Viewport(view as unknown as IView, false);
        document.body.appendChild(viewport);

        dispatchDoubleClick(viewport, 12, 34);

        expect(view.detectVisual).toHaveBeenCalledWith(12, 34);
        expect(doc.visual.context.getNode).toHaveBeenCalledWith(visual);
        expect(pubSubRecorder.pubs).toEqual([{ topic: "nodeDoubleClicked", args: [node] }]);
    });

    test("should let a session's handler take the double-click instead", () => {
        const doubleClick = rs.fn();
        const { doc, view } = createMockView(
            [{ id: "visual-1" }],
            { name: "node-1" },
            {
                isEnabled: true,
                doubleClick,
            },
        );
        viewport = new Viewport(view as unknown as IView, false);
        document.body.appendChild(viewport);

        dispatchDoubleClick(viewport, 12, 34);

        // the handler owns the gesture, so the node path stands down — and the node lookup is
        // never even made
        expect(doubleClick).toHaveBeenCalledWith(view, expect.objectContaining({ type: "dblclick" }));
        expect(view.detectVisual).not.toHaveBeenCalled();
        expect(pubSubRecorder.pubs).toEqual([]);
        expect(doc.visual.context.getNode).not.toHaveBeenCalled();
    });

    test("should fall back to the node when the handler is disabled", () => {
        const doubleClick = rs.fn();
        const node = { name: "node-1" };
        const { doc, view } = createMockView([{ id: "visual-1" }], node, { isEnabled: false, doubleClick });
        viewport = new Viewport(view as unknown as IView, false);
        document.body.appendChild(viewport);

        dispatchDoubleClick(viewport, 12, 34);

        expect(doubleClick).not.toHaveBeenCalled();
        expect(pubSubRecorder.pubs).toEqual([{ topic: "nodeDoubleClicked", args: [node] }]);
        expect(doc.visual.context.getNode).toHaveBeenCalled();
    });

    test("should not publish when double-clicking empty space", () => {
        const { view } = createMockView([], undefined);
        viewport = new Viewport(view as unknown as IView, false);
        document.body.appendChild(viewport);

        dispatchDoubleClick(viewport, 5, 6);

        expect(pubSubRecorder.pubs).toEqual([]);
    });
});

describe("Viewport pointer offsets", () => {
    let viewport: Viewport | undefined;

    afterEach(() => {
        viewport?.remove();
        viewport = undefined;
        pubSubRecorder.reset();
    });

    test("pins the offset onto the viewport when an overlay is the pointer's target", () => {
        const { doc, view } = createMockView([], undefined);
        const handler = {
            isEnabled: true,
            pointerDown: rs.fn(),
            pointerMove: rs.fn(),
            pointerUp: rs.fn(),
            keyDown: rs.fn(),
            dispose: () => {},
        };
        (doc.visual as any).eventHandler = handler;
        (doc.visual as any).viewHandler = { isEnabled: false, dispose: () => {} };
        viewport = new Viewport(view as unknown as IView, false);
        document.body.appendChild(viewport);

        // a sketch constraint badge: a DOM overlay inside the viewport that takes pointer
        // events, so the offsets the browser reports are measured from *it*
        const badge = document.createElement("span");
        viewport.appendChild(badge);
        viewport.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
        badge.getBoundingClientRect = () => ({ left: 30, top: 40 }) as DOMRect;

        const event = new MouseEvent("pointerdown", { bubbles: true });
        Object.defineProperties(event, { offsetX: { value: 5 }, offsetY: { value: 6 } });
        badge.dispatchEvent(event);

        // 5,6 from the badge is 35,46 in the viewport — what every handler downstream
        // (the sketch's, the drag handles) feeds to `view.rayAt`
        expect(handler.pointerDown).toHaveBeenCalledWith(
            view,
            expect.objectContaining({ offsetX: 35, offsetY: 46 }),
        );
    });

    test("forwards pointer cancellation to the active handlers", () => {
        const { doc, view } = createMockView([], undefined);
        const handler = {
            isEnabled: true,
            pointerCancel: rs.fn(),
        };
        (doc.visual as any).eventHandler = handler;
        (doc.visual as any).viewHandler = { isEnabled: false, dispose: () => {} };
        viewport = new Viewport(view as unknown as IView, false);
        document.body.appendChild(viewport);

        viewport.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));

        expect(handler.pointerCancel).toHaveBeenCalledWith(
            view,
            expect.objectContaining({ type: "pointercancel" }),
        );
    });

    test("leaves the offset alone when the pointer is over the viewport itself", () => {
        const { doc, view } = createMockView([], undefined);
        const handler = {
            isEnabled: true,
            pointerDown: rs.fn(),
            pointerMove: rs.fn(),
            pointerUp: rs.fn(),
            keyDown: rs.fn(),
            dispose: () => {},
        };
        (doc.visual as any).eventHandler = handler;
        (doc.visual as any).viewHandler = { isEnabled: false, dispose: () => {} };
        viewport = new Viewport(view as unknown as IView, false);
        document.body.appendChild(viewport);

        const event = new MouseEvent("pointerdown", { bubbles: true });
        Object.defineProperties(event, { offsetX: { value: 5 }, offsetY: { value: 6 } });
        viewport.dispatchEvent(event);

        expect(handler.pointerDown).toHaveBeenCalledWith(
            view,
            expect.objectContaining({ offsetX: 5, offsetY: 6 }),
        );
    });
});

describe("Viewport section action", () => {
    let viewport: Viewport | undefined;

    afterEach(() => {
        viewport?.remove();
        viewport = undefined;
        pubSubRecorder.reset();
    });

    function clickSectionButton() {
        const button = viewport?.querySelector("svg[icon='icon-sectionView']") as
            | (SVGElement & { _onclick?: (event: MouseEvent) => void })
            | undefined;
        expect(button).not.toBeNull();
        button?._onclick?.(new MouseEvent("click"));
    }

    test("creates a section when none is active", () => {
        const { view } = createMockView([], undefined);
        viewport = new Viewport(view as unknown as IView, true);

        clickSectionButton();

        expect(pubSubRecorder.pubs).toEqual([{ topic: "executeCommand", args: ["act.sectionView"] }]);
    });

    test("creates another section when one is already active", () => {
        const { view } = createMockView([], undefined);
        Object.defineProperty(view, "sectionPlanes", { value: [{}] });
        viewport = new Viewport(view as unknown as IView, true);

        clickSectionButton();

        expect(pubSubRecorder.pubs).toEqual([{ topic: "executeCommand", args: ["act.sectionView"] }]);
        const button = viewport.querySelector("svg[icon='icon-sectionView']");
        expect(button?.getAttribute("title")).toBe("command.act.sectionView");
    });

    test("activates the viewport that owns the section button", () => {
        const first = createMockView([], undefined);
        const second = { ...first.view } as unknown as IView;
        const application = first.doc.application as { activeView: unknown };
        application.activeView = first.view;
        viewport = new Viewport(second, true);

        clickSectionButton();

        expect(application.activeView).toBe(second);
        expect(pubSubRecorder.pubs).toEqual([{ topic: "executeCommand", args: ["act.sectionView"] }]);
    });
});
