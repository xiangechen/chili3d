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
        I18n: { set: () => {} },
        PubSub: pubSubRecorder.stub,
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

function createMockView(detected: unknown[], node: unknown) {
    const doc = {
        acts: {
            length: 0,
            forEach: () => {},
            onCollectionChanged: rs.fn(),
            removeCollectionChanged: rs.fn(),
        },
        visual: { context: { getNode: rs.fn(() => node) } },
        application: { activeView: undefined },
    };
    const view = {
        document: doc,
        mode: "perspective",
        cameraController: {},
        setDom: rs.fn(),
        update: rs.fn(),
        detectVisual: rs.fn(() => detected),
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

    test("should not publish when double-clicking empty space", () => {
        const { view } = createMockView([], undefined);
        viewport = new Viewport(view as unknown as IView, false);
        document.body.appendChild(viewport);

        dispatchDoubleClick(viewport, 5, 6);

        expect(pubSubRecorder.pubs).toEqual([]);
    });
});
