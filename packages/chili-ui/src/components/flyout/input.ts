// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Executor, I18n, IDisposable } from "chili-core";
import { Control } from "../control";
import { Label } from "../label";
import { TextBox } from "../textbox";

import style from "./input.module.css";

export class Input extends Control implements IDisposable {
    private readonly _cancelledCallbacks: (() => void)[] = [];
    private readonly _completedCallbacks: (() => void)[] = [];

    private readonly textbox: TextBox;
    private tip?: Label;

    constructor(readonly executor: Executor<string, keyof I18n>) {
        super(style.panel);
        this.textbox = new TextBox();
        this.append(this.textbox);
        this.textbox.addEventListener("keydown", this.onKeyDown);
    }

    onCancelled(callback: () => void) {
        this._cancelledCallbacks.push(callback);
    }

    onCompleted(callback: () => void) {
        this._completedCallbacks.push(callback);
    }

    get text(): string {
        return this.textbox.text;
    }

    override focus() {
        this.textbox.focus();
    }

    override dispose(): void | Promise<void> {
        this.textbox.removeEventListener("keydown", this.onKeyDown);
        this._cancelledCallbacks.length = 0;
        this._completedCallbacks.length = 0;
    }

    private showTip(tip: keyof I18n) {
        if (this.tip === undefined) {
            this.tip = new Label().i18nText(tip).addClass(style.error);
            this.append(this.tip);
        } else {
            this.tip.i18nText(tip);
        }
    }

    private removeTip() {
        if (this.tip === undefined) return;
        this.removeChild(this.tip);
        this.tip = undefined;
    }

    private onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
            let validation = this.executor.validate(this.textbox.text);
            if (validation.isOk) {
                this._completedCallbacks.forEach((x) => x());
                this.executor.execute(this.textbox.text);
            } else {
                this.showTip(validation.error!);
            }
        } else if (e.key === "Escape") {
            this._cancelledCallbacks.forEach((x) => x());
        } else {
            this.removeTip();
        }
    };
}

customElements.define("chili-input", Input);
