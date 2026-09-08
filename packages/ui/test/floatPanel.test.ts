// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";

// Set up global app mock before any imports that reference it
Object.defineProperty(globalThis, "app", {
    configurable: true,
    writable: true,
    value: { mainWindow: undefined },
});

// Mock CSS modules
rs.mock("../src/floatPanel.module.css", () => ({
    root: "fp-root",
    header: "fp-header",
    title: "fp-title",
    actions: "fp-actions",
    closeButton: "fp-close",
    content: "fp-content",
    resizeHandle: "fp-resize",
}));

// Mock element helpers
import "./_helpers/mockElement";

// Mock Localize
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { LocalizeMock } = rs.hoisted(() => require("./_helpers/coreMocks"));
    return {
        ...actual,
        Localize: LocalizeMock,
    };
});

import { FloatPanel } from "../src/floatPanel";

describe("FloatPanel", () => {
    describe("constructor defaults", () => {
        test("should set default width when not specified", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            expect(panel.style.width).toBe("300px"); // DEFAULT_WIDTH
        });

        test("should set custom width from options", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
                width: 500,
            });
            expect(panel.style.width).toBe("500px");
        });

        test("should set default height when not specified", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            expect(panel.style.height).toBe("200px"); // DEFAULT_HEIGHT
        });

        test("should set custom height from options", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
                height: 400,
            });
            expect(panel.style.height).toBe("400px");
        });

        test("should set default position (20, 20) when not specified", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            expect(panel.style.left).toBe("20px");
            expect(panel.style.top).toBe("20px");
        });

        test("should set custom position from options", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
                x: 100,
                y: 200,
            });
            expect(panel.style.left).toBe("100px");
            expect(panel.style.top).toBe("200px");
        });

        test("should set minWidth and minHeight from options", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
                minWidth: 250,
                minHeight: 150,
            });
            expect(panel.style.minWidth).toBe("250px");
            expect(panel.style.minHeight).toBe("150px");
        });

        test("should default minWidth to 150px when not specified", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            expect(panel.style.minWidth).toBe("150px");
        });

        test("should default minHeight to 100px when not specified", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            expect(panel.style.minHeight).toBe("100px");
        });
    });

    describe("DOM structure", () => {
        test("should contain header element with title class", () => {
            const panel = new FloatPanel({
                title: "Settings" as I18nKeys,
                content: document.createElement("div"),
            });
            const header = panel.querySelector('[class*="header"]');
            expect(header).not.toBeNull();
        });

        test("should contain content area", () => {
            const content = document.createElement("div");
            content.id = "my-content";
            const panel = new FloatPanel({ title: "Test" as I18nKeys, content });
            expect(panel.innerHTML).toContain("my-content");
        });

        test("should contain resize handle element", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            const handle = panel.querySelector('[class*="resize"]');
            expect(handle).not.toBeNull();
        });

        test("should contain close button in the header", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            const header = panel.querySelector('[class*="header"]');
            const closeBtn = header?.querySelector('[class*="close"]');
            expect(closeBtn).not.toBeNull();
        });

        test("should host action buttons in the header between title and close", () => {
            const action = document.createElement("button");
            action.id = "my-action";
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
                actions: [action],
            });
            const header = panel.querySelector('[class*="header"]');
            const hosted = header?.querySelector("#my-action");
            expect(hosted).not.toBeNull();
            expect(hosted?.parentElement?.className).toContain("fp-actions");
        });

        test("should render an empty actions container when no actions given", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            const actions = panel.querySelector('[class*="fp-actions"]');
            expect(actions).not.toBeNull();
            expect(actions?.childElementCount).toBe(0);
        });

        test("should not start dragging when an action button is pressed", () => {
            const action = document.createElement("button");
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
                actions: [action],
            });
            action.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
            action.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: 50 }));
            expect(panel.style.left).toBe("20px");
            expect(panel.style.top).toBe("20px");
        });
    });

    describe("dispose", () => {
        function dispatchKeydown(panel: FloatPanel): boolean {
            let stopped = false;
            const event = new KeyboardEvent("keydown", { key: "a", bubbles: true });
            Object.defineProperty(event, "stopImmediatePropagation", {
                value: () => {
                    stopped = true;
                },
            });
            panel.dispatchEvent(event);
            return stopped;
        }

        test("should remove the keydown listener on dispose", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            // listener active before dispose
            expect(dispatchKeydown(panel)).toBe(true);

            panel.dispose();
            expect(dispatchKeydown(panel)).toBe(false);
        });

        test("should be idempotent — second dispose keeps listeners removed", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            panel.dispose();
            panel.dispose();

            expect(dispatchKeydown(panel)).toBe(false);
        });
    });

    describe("keyboard event interception", () => {
        test("should have tabIndex set for keyboard focus", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            expect(panel.tabIndex).toBe(-1);
        });

        test("should stop keydown propagation", () => {
            const panel = new FloatPanel({
                title: "Test" as I18nKeys,
                content: document.createElement("div"),
            });
            let stopped = false;
            const event = new KeyboardEvent("keydown", { key: "a", bubbles: true });
            Object.defineProperty(event, "stopImmediatePropagation", {
                value: () => {
                    stopped = true;
                },
            });
            panel.dispatchEvent(event);

            expect(stopped).toBe(true);
        });
    });
});

describe("showFloatPanel constructor equivalent", () => {
    test("should create a FloatPanel and verify defaults", () => {
        const panel = new FloatPanel({
            title: "Test" as I18nKeys,
            content: document.createElement("div"),
        });
        expect(panel.style.width).toBe("300px");
        expect(panel.style.height).toBe("200px");
        panel.remove();
    });
});
