// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { input, label } from "chili-controls";
import { I18n, I18nKeys, IDisposable, Localize, Result } from "chili-core";
import style from "./input.module.css";

export class Input extends HTMLElement implements IDisposable {
    private readonly _cancelledCallbacks: (() => void)[] = [];
    private readonly _completedCallbacks: (() => void)[] = [];
    private readonly textbox: HTMLInputElement;
    private tip?: HTMLLabelElement;

    constructor(
        text: string,
        readonly handler: (text: string) => Result<string, I18nKeys>,
    ) {
        super();
        this.className = style.panel;
        this.textbox = input({
            value: text,
            onkeydown: this.handleKeyDown,
        });
        this.append(this.textbox);
    }

    onCancelled(callback: () => void) {
        this._cancelledCallbacks.push(callback);
    }

    onCompleted(callback: () => void) {
        this._completedCallbacks.push(callback);
    }

    get text(): string {
        return this.textbox.value;
    }

    override focus() {
        this.textbox.focus();
    }

    dispose() {
        this._cancelledCallbacks.length = 0;
        this._completedCallbacks.length = 0;
    }

    private showTip(tip: I18nKeys) {
        if (this.tip === undefined) {
            this.tip = label({
                textContent: new Localize(tip),
                className: style.error,
            });
            this.append(this.tip);
        } else {
            I18n.set(this.tip, "textContent", tip);
        }
    }

    private removeTip() {
        if (this.tip === undefined) return;
        this.removeChild(this.tip);
        this.tip = undefined;
    }

    private readonly handleKeyDown = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            this.processEnterKey();
        } else if (e.key === "Escape") {
            this._cancelledCallbacks.forEach((callback) => callback());
        } else {
            this.removeTip();
        }
    };

    private processEnterKey() {
        this.textbox.readOnly = true;
        const error = this.handler(this.textbox.value);
        if (error.isOk) {
            this._completedCallbacks.forEach((callback) => callback());
        } else {
            this.textbox.readOnly = false;
            this.showTip(error.error);
        }
    }
}

customElements.define("chili-input", Input);
