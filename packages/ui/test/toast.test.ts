// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";

// Mock CSS module
rs.mock("../src/toast/toast.module.css", () => ({
    toast: "toast-toast",
    info: "toast-info",
    error: "toast-error",
    warning: "toast-warning",
}));

// Mock I18n
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    return {
        ...actual,
        I18n: {
            translate: (key: string, ..._args: unknown[]) => key,
        },
    };
});

// Mock label from @chili3d/element
rs.mock("@chili3d/element", () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    label: (props: any) => {
        const el = document.createElement("label");
        if (props && typeof props === "object") {
            if (typeof props.className === "string") el.className = props.className;
            if (typeof props.textContent === "string") el.textContent = props.textContent;
        }
        return el;
    },
}));

import { Toast } from "../src/toast";

function getToast(): HTMLElement | null {
    return document.querySelector("label");
}

function getToasts(): NodeListOf<HTMLElement> {
    return document.querySelectorAll("label");
}

describe("Toast", () => {
    beforeEach(() => {
        document.body.querySelectorAll("label").forEach((el) => el.remove());
    });

    afterEach(() => {
        document.body.querySelectorAll("label").forEach((el) => el.remove());
    });

    describe("info", () => {
        test("should append a toast element to document.body", () => {
            const before = document.body.children.length;
            Toast.info("test.message" as unknown as Parameters<typeof Toast.info>[0]);
            expect(document.body.children.length).toBeGreaterThan(before);
        });

        test("should set the translated text as textContent", () => {
            Toast.info("test.message" as unknown as Parameters<typeof Toast.info>[0]);
            const toast = getToast();
            expect(toast).not.toBeNull();
            expect(toast?.textContent).toBe("test.message");
        });
    });

    describe("error", () => {
        test("should display error message directly (no translation)", () => {
            Toast.error("Connection failed");
            const toast = getToast();
            expect(toast).not.toBeNull();
            expect(toast?.textContent).toBe("Connection failed");
        });
    });

    describe("warn", () => {
        test("should display warning message directly", () => {
            Toast.warn("Low memory");
            const toast = getToast();
            expect(toast).not.toBeNull();
            expect(toast?.textContent).toBe("Low memory");
        });
    });

    describe("auto-dismiss behavior", () => {
        test("should replace previous toast when showing a new one", () => {
            Toast.info("first" as unknown as Parameters<typeof Toast.info>[0]);
            const first = getToast();
            expect(first?.textContent).toBe("first");

            Toast.info("second" as unknown as Parameters<typeof Toast.info>[0]);
            // The first toast should be removed, second should show
            const toasts = getToasts();
            expect(toasts.length).toBe(1);
        });

        test("should show only one toast at a time after multiple calls", () => {
            Toast.info("a" as unknown as Parameters<typeof Toast.info>[0]);
            Toast.info("b" as unknown as Parameters<typeof Toast.info>[0]);
            Toast.error("c");

            const toasts = getToasts();
            expect(toasts.length).toBe(1);
            expect(toasts[0]?.textContent ?? "").toBe("c");
        });
    });
});
