// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IDisposable } from "chili-core";
import { Control } from "../control";
import { Label } from "../label";
import { TextBox } from "../textbox";

import style from "./input.module.css";

export class Input extends Control implements IDisposable {
    private readonly textbox: TextBox;
    private tip?: Label;
    constructor(readonly callback: (e: KeyboardEvent) => void) {
        super(style.panel);
        this.textbox = new TextBox();
        this.append(this.textbox);
        this.textbox.addEventListener("keydown", this.keyDownHandle);
    }

    get text(): string {
        return this.textbox.text;
    }

    override focus() {
        this.textbox.focus();
    }

    override dispose(): void | Promise<void> {
        this.textbox.removeEventListener("keydown", this.keyDownHandle);
    }

    showTip(tip: keyof I18n) {
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

    private keyDownHandle = (e: KeyboardEvent) => {
        this.removeTip();
        this.callback(e);
    };
}

customElements.define("chili-input", Input);
