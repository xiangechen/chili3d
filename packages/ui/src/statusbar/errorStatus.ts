// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { errorText, I18n, PubSub } from "@chili3d/core";
import { button, div } from "@chili3d/element";
import style from "./errorStatus.module.css";

interface ErrorEntry {
    time: string;
    text: string;
}

const MAX_ERROR_ENTRIES = 100;

function formatError(value: unknown): string {
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    if (typeof value === "object" && value !== null) {
        const stack = (value as { stack?: unknown }).stack;
        if (typeof stack === "string") return stack;
    }
    return errorText(value);
}

export class ErrorStatus extends HTMLElement {
    private count = 0;
    private readonly entries: ErrorEntry[] = [];
    private readonly unmatchedDisplayErrors: { message: string; entry: ErrorEntry }[] = [];
    private displayResetQueued = false;
    private readonly trigger = button({
        className: style.button,
        type: "button",
        onclick: () => this.showErrors(),
    });

    constructor() {
        super();
        I18n.set(this.trigger, "title", "statusBar.viewErrors");
        I18n.set(this.trigger, "textContent", "statusBar.errors{0}", 0);
        this.trigger.setAttribute("data-count", "0");
        this.append(this.trigger);
    }

    connectedCallback() {
        PubSub.default.sub("applicationError", this.onApplicationError);
        PubSub.default.sub("displayError", this.onDisplayError);
        PubSub.default.sub("loggerError", this.onLoggerError);
        PubSub.default.pub("applicationErrorReady");
    }

    disconnectedCallback() {
        PubSub.default.remove("applicationError", this.onApplicationError);
        PubSub.default.remove("displayError", this.onDisplayError);
        PubSub.default.remove("loggerError", this.onLoggerError);
    }

    private readonly onApplicationError = (message: unknown, optionalParams: unknown[]) => {
        this.record([message, ...optionalParams]);
    };

    private readonly onDisplayError = (message: string) => {
        const entry = this.record([message]);
        this.unmatchedDisplayErrors.push({ message, entry });
        if (this.displayResetQueued) return;
        this.displayResetQueued = true;
        queueMicrotask(() => {
            this.unmatchedDisplayErrors.length = 0;
            this.displayResetQueued = false;
        });
    };

    private readonly onLoggerError = (message: unknown, optionalParams: unknown[]) => {
        const values = [message, ...optionalParams];
        if (!this.upgradeDisplayedError(values)) this.record(values);
    };

    private upgradeDisplayedError(values: unknown[]) {
        const index = this.unmatchedDisplayErrors.findIndex(({ message }) =>
            values.some((value) => errorText(value) === message),
        );
        if (index < 0) return false;
        const [{ entry }] = this.unmatchedDisplayErrors.splice(index, 1);
        entry.text = values.map(formatError).join(" ");
        return true;
    }

    private record(values: unknown[]) {
        const entry = {
            time: new Date().toLocaleString(),
            text: values.map(formatError).join(" "),
        };
        this.count++;
        this.entries.push(entry);
        if (this.entries.length > MAX_ERROR_ENTRIES) this.entries.shift();
        this.trigger.setAttribute("data-count", String(this.count));
        I18n.set(this.trigger, "textContent", "statusBar.errors{0}", this.count);
        return entry;
    }

    private showErrors() {
        const content = div({ className: style.log });
        for (const entry of [...this.entries].reverse()) content.append(this.errorEntry(entry));
        PubSub.default.pub("showDialog", "statusBar.errorLog", content, [
            // Enter activates the first onclick button; keep Confirm ahead of Clear.
            { content: "common.confirm", onclick: () => {} },
            { content: "statusBar.clearErrors", onclick: () => this.clear() },
            { content: "common.cancel" },
        ]);
    }

    private errorEntry(entry: ErrorEntry) {
        const message = document.createElement("pre");
        message.className = style.message;
        message.textContent = entry.text;
        return div(
            { className: style.entry },
            div({ className: style.time, textContent: entry.time }),
            message,
        );
    }

    private clear() {
        this.count = 0;
        this.entries.length = 0;
        this.unmatchedDisplayErrors.length = 0;
        this.trigger.setAttribute("data-count", "0");
        I18n.set(this.trigger, "textContent", "statusBar.errors{0}", 0);
    }
}

customElements.define("chili-error-status", ErrorStatus);
