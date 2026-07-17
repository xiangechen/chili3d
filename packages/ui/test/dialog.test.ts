// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { DialogButton, I18nKeys } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";

// Mock the CSS module
rs.mock("../src/dialog.module.css", () => ({
    root: "dialog-root",
    title: "dialog-title",
    content: "dialog-content",
    buttons: "dialog-buttons",
}));

// Mock I18n
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => {
        const core = require("@chili3d/core");
        return core;
    });
    return {
        ...actual,
        I18n: {
            translate: (key: string) => key,
        },
    };
});

// Mock element helpers
rs.mock("@chili3d/element", () => ({
    div: (props: any, ...children: any[]) => {
        const el = document.createElement("div");
        if (props && typeof props === "object" && !(props instanceof Node)) {
            if (props.className) el.className = props.className;
            if (props.textContent) el.textContent = props.textContent;
            if (props.onclick) el.onclick = props.onclick;
            if (props.style) Object.assign(el.style, props.style);
        }
        children.filter((c: any) => c instanceof Node).forEach((c: any) => el.appendChild(c));
        return el;
    },
    button: (props: any) => {
        const el = document.createElement("button");
        if (props && typeof props === "object") {
            if (props.textContent) el.textContent = props.textContent;
            if (props.onclick) el.onclick = props.onclick;
        }
        return el;
    },
    span: (props: any) => {
        const el = document.createElement("span");
        if (props && typeof props === "object") {
            if (props.textContent) el.textContent = props.textContent;
        }
        return el;
    },
}));

// Set up global app mock before importing dialog
Object.defineProperty(globalThis, "app", {
    configurable: true,
    writable: true,
    value: { mainWindow: undefined },
});

import { showDialog } from "../src/dialog";

describe("showDialog", () => {
    // Cleanup dialogs after each test
    afterEach(() => {
        document.body.querySelectorAll("dialog").forEach((d) => d.remove());
    });

    test("should create a dialog element and append it to document.body", () => {
        const content = document.createElement("div");
        content.textContent = "test content";
        showDialog("dialog.title" as I18nKeys, content);

        const dialog = document.body.querySelector("dialog");
        expect(dialog).not.toBeNull();
    });

    test("should render title as translated text", () => {
        const content = document.createElement("div");
        showDialog("dialog.confirm" as I18nKeys, content);

        const dialog = document.body.querySelector("dialog")!;
        const titleEl = dialog.querySelector('[class*="title"]');
        expect(titleEl).not.toBeNull();
    });

    test("should render the content element inside the dialog", () => {
        const content = document.createElement("span");
        content.id = "custom-content";
        showDialog("dialog.title" as I18nKeys, content);

        const dialog = document.body.querySelector("dialog")!;
        expect(dialog.innerHTML).toContain("custom-content");
    });

    test("should render default buttons (confirm + cancel) when no buttons provided", () => {
        const content = document.createElement("div");
        showDialog("dialog.title" as I18nKeys, content);

        const dialog = document.body.querySelector("dialog")!;
        const buttons = dialog.querySelectorAll("button");
        expect(buttons.length).toBe(2);
    });

    test("should render custom buttons when array provided", () => {
        const content = document.createElement("div");
        const customButtons: DialogButton[] = [
            { content: "common.ok" as I18nKeys, onclick: async () => {} },
            { content: "common.cancel" as I18nKeys },
            { content: "common.retry" as I18nKeys, onclick: async () => {} },
        ];
        showDialog("dialog.title" as I18nKeys, content, customButtons);

        const dialog = document.body.querySelector("dialog")!;
        const buttons = dialog.querySelectorAll("button");
        expect(buttons.length).toBe(3);
    });

    test("should render single confirm button when function callback provided", () => {
        const content = document.createElement("div");
        const callback = () => {};
        showDialog("dialog.title" as I18nKeys, content, callback);

        const dialog = document.body.querySelector("dialog")!;
        const buttons = dialog.querySelectorAll("button");
        expect(buttons.length).toBe(2); // confirm + cancel
    });

    test("should close dialog when close button (Cancel) is clicked", () => {
        const content = document.createElement("div");
        showDialog("dialog.title" as I18nKeys, content);

        const dialog = document.body.querySelector("dialog")!;
        const buttons = dialog.querySelectorAll("button");
        const cancelBtn = buttons[1]; // second button is cancel

        cancelBtn.click();

        // Dialog should be removed from DOM
        expect(document.body.querySelector("dialog")).toBeNull();
    });

    test("should close dialog when confirm button is clicked", () => {
        const content = document.createElement("div");
        showDialog("dialog.title" as I18nKeys, content);

        const dialog = document.body.querySelector("dialog")!;
        const buttons = dialog.querySelectorAll("button");
        const confirmBtn = buttons[0]; // first button is confirm

        confirmBtn.click();

        expect(document.body.querySelector("dialog")).toBeNull();
    });

    test("should close dialog on Escape key press", () => {
        const content = document.createElement("div");
        showDialog("dialog.title" as I18nKeys, content);

        const dialog = document.body.querySelector("dialog")!;
        dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

        expect(document.body.querySelector("dialog")).toBeNull();
    });

    test("should trigger confirm button on Enter key press", () => {
        let clicked = false;
        const content = document.createElement("div");
        const buttons: DialogButton[] = [
            {
                content: "common.confirm" as I18nKeys,
                onclick: async () => {
                    clicked = true;
                },
            },
            { content: "common.cancel" as I18nKeys },
        ];
        showDialog("dialog.title" as I18nKeys, content, buttons);

        const dialog = document.body.querySelector("dialog")!;
        dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

        expect(clicked).toBe(true);
        expect(document.body.querySelector("dialog")).toBeNull();
    });

    test("should keep dialog open when shouldClose returns false", () => {
        const content = document.createElement("div");
        const buttons: DialogButton[] = [
            {
                content: "common.confirm" as I18nKeys,
                onclick: async () => {},
                shouldClose: () => false,
            },
            { content: "common.cancel" as I18nKeys },
        ];
        showDialog("dialog.title" as I18nKeys, content, buttons);

        const dialog = document.body.querySelector("dialog")!;
        const confirmBtn = dialog.querySelectorAll("button")[0];
        confirmBtn.click();

        // Dialog should still be in DOM because shouldClose returned false
        expect(document.body.querySelector("dialog")).not.toBeNull();
    });

    test("should call button onclick callback after close", async () => {
        let onClickCalled = false;
        const content = document.createElement("div");
        const buttons: DialogButton[] = [
            {
                content: "common.confirm" as I18nKeys,
                onclick: async () => {
                    onClickCalled = true;
                },
            },
        ];
        showDialog("dialog.title" as I18nKeys, content, buttons);

        const dialog = document.body.querySelector("dialog")!;
        const confirmBtn = dialog.querySelectorAll("button")[0];
        await confirmBtn.click();

        expect(onClickCalled).toBe(true);
    });
});
