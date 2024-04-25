// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys, IDisposable, Result } from "chili-core";
import { input, label } from "../controls";
import { localize } from "../localize";
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
                textContent: localize(tip),
                className: style.error,
            });
            this.append(this.tip);
        } else {
            I18n.set(this.tip, tip);
        }
    }

    private removeTip() {
        if (this.tip === undefined) return;
        this.removeChild(this.tip);
        this.tip = undefined;
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            this.textbox.readOnly = true;
            let error = this.handler(this.textbox.value);
            if (error.isOk) {
                this._completedCallbacks.forEach((x) => x());
            } else {
                this.textbox.readOnly = false;
                this.showTip(error.error);
            }
        } else if (e.key === "Escape") {
            this._cancelledCallbacks.forEach((x) => x());
        } else {
            this.removeTip();
        }
    };
}

customElements.define("chili-input", Input);
