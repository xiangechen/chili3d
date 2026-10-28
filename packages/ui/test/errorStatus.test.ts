// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type DialogButton, type I18nKeys, PubSub } from "@chili3d/core";

rs.mock("../src/statusbar/errorStatus.module.css", () => ({
    button: "es-button",
    log: "es-log",
    entry: "es-entry",
    time: "es-time",
    message: "es-message",
}));

import { ErrorStatus } from "../src/statusbar/errorStatus";
import { mustQuery } from "./_helpers/domHelpers";

function createStatus() {
    const status = new ErrorStatus();
    document.body.append(status);
    return { status, button: mustQuery<HTMLButtonElement>(status, ".es-button") };
}

describe("ErrorStatus", () => {
    let dialogTitle: I18nKeys | undefined;
    let dialogContent: HTMLElement | undefined;
    let dialogButtons: DialogButton[] | (() => void) | undefined;

    const onShowDialog = (title: I18nKeys, content: HTMLElement, buttons?: DialogButton[] | (() => void)) => {
        dialogTitle = title;
        dialogContent = content;
        dialogButtons = buttons;
    };

    function currentDialog() {
        expect(dialogContent).toBeDefined();
        if (!dialogContent) throw new Error("The error dialog was not opened");
        return dialogContent;
    }

    beforeEach(() => {
        dialogTitle = undefined;
        dialogContent = undefined;
        dialogButtons = undefined;
        PubSub.default.sub("showDialog", onShowDialog);
    });

    afterEach(() => {
        PubSub.default.remove("showDialog", onShowDialog);
        document.body.replaceChildren();
    });

    test("shows zero initially and upgrades a displayed error with the logger stack", async () => {
        const { button } = createStatus();

        expect(button.hidden).toBe(false);
        expect(button.textContent).toBe("statusBar.errors0");
        expect(button.getAttribute("data-count")).toBe("0");
        PubSub.default.pub("displayError", "command boom");
        expect(button.textContent).toBe("statusBar.errors1");
        expect(button.getAttribute("data-count")).toBe("1");
        PubSub.default.pub("loggerError", new Error("command boom"), []);
        expect(button.textContent).toBe("statusBar.errors1");
        expect(button.getAttribute("data-count")).toBe("1");
        button.click();
        expect(currentDialog().textContent).toContain("Error: command boom");
        expect(currentDialog().querySelectorAll(".es-entry").length).toBe(1);

        await Promise.resolve();
        PubSub.default.pub("loggerError", new Error("command boom"), []);
        expect(button.textContent).toBe("statusBar.errors2");
    });

    test("ignores routine validation messages", () => {
        const { button } = createStatus();

        PubSub.default.pub("displayValidation", "Select two edges");

        expect(button.textContent).toBe("statusBar.errors0");
    });

    test("does not swallow an unrelated logger with a longer message", () => {
        const { button } = createStatus();

        PubSub.default.pub("displayError", "a");
        PubSub.default.pub("loggerError", new Error("a unrelated"), []);

        expect(button.textContent).toBe("statusBar.errors2");
    });

    test("counts logger errors and shows their messages and stacks", () => {
        const { button } = createStatus();
        const error = new Error("logger boom");

        PubSub.default.pub("loggerError", "failed", [error]);
        button.click();

        expect(button.hidden).toBe(false);
        expect(button.textContent).toBe("statusBar.errors1");
        expect(dialogTitle).toBe("statusBar.errorLog");
        expect(currentDialog().textContent).toContain("failed");
        expect(currentDialog().textContent).toContain("Error: logger boom");
        expect(currentDialog().querySelectorAll(".es-entry").length).toBe(1);
    });

    test("counts application errors and unhandled promise rejections", () => {
        const { button } = createStatus();
        PubSub.default.pub("applicationError", "window boom\napp.ts:10:20", []);
        PubSub.default.pub("applicationError", "promise boom", []);
        button.click();

        expect(button.textContent).toBe("statusBar.errors2");
        expect(currentDialog().textContent).toContain("window boom");
        expect(currentDialog().textContent).toContain("app.ts:10:20");
        expect(currentDialog().textContent).toContain("promise boom");
    });

    test("clears the count and records from the dialog", () => {
        const { button } = createStatus();
        PubSub.default.pub("loggerError", "old error", []);
        button.click();
        expect(Array.isArray(dialogButtons)).toBe(true);
        if (!Array.isArray(dialogButtons)) throw new Error("Dialog buttons were not provided");
        expect(dialogButtons[0]?.content).toBe("common.confirm");
        expect(dialogButtons[0]?.onclick).toBeDefined();
        expect(dialogButtons[2]?.content).toBe("common.cancel");
        const clear = dialogButtons.find((item) => item.content === "statusBar.clearErrors");
        expect(clear).toBeDefined();
        if (!clear) throw new Error("Clear button was not provided");

        clear.onclick?.();

        expect(button.hidden).toBe(false);
        expect(button.textContent).toBe("statusBar.errors0");
        expect(button.getAttribute("data-count")).toBe("0");
        PubSub.default.pub("loggerError", "new error", []);
        expect(button.textContent).toBe("statusBar.errors1");
        expect(button.getAttribute("data-count")).toBe("1");
    });

    test("keeps only the latest 100 records while retaining the total count", () => {
        const { button } = createStatus();
        for (let i = 0; i < 105; i++) PubSub.default.pub("loggerError", `error ${i}`, []);

        button.click();

        expect(button.textContent).toBe("statusBar.errors105");
        expect(currentDialog().querySelectorAll(".es-entry").length).toBe(100);
        expect(currentDialog().textContent).toContain("error 104");
        expect(currentDialog().textContent).toContain("error 5");
        expect(currentDialog().textContent).not.toContain("error 0");
    });

    test("stops listening while disconnected and resumes after remounting", () => {
        const { status, button } = createStatus();
        PubSub.default.pub("loggerError", "first", []);
        status.remove();
        PubSub.default.pub("loggerError", "detached", []);
        PubSub.default.pub("applicationError", "also detached", []);
        expect(button.textContent).toBe("statusBar.errors1");

        document.body.append(status);
        PubSub.default.pub("loggerError", "after remount", []);

        expect(button.textContent).toBe("statusBar.errors2");
    });
});
