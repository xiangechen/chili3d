// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, i18n, IDisposable } from "chili-shared";
import { IView } from "chili-vis";
import { Control } from "../control";
import style from "./input.module.css";

export class Input implements IDisposable {
    readonly dom: HTMLDivElement;
    private readonly textbox: HTMLInputElement;
    private span?: HTMLSpanElement;
    constructor(readonly view: IView, readonly callback: (view: IView, e: KeyboardEvent) => void) {
        this.dom = Control.div(style.panel);
        this.textbox = Control.textBox();
        this.dom.appendChild(this.textbox);
        this.textbox.addEventListener("keydown", this.keyDownHandle);
    }

    get text(): string {
        return this.textbox.textContent ?? "";
    }

    focus() {
        this.textbox.focus();
    }

    dispose(): void | Promise<void> {
        this.textbox.removeEventListener("keydown", this.keyDownHandle);
    }

    showError(error: keyof I18n) {
        if (this.span === undefined) {
            this.span = Control.span(error, style.error);
            this.dom.appendChild(this.span);
        } else {
            Control.setText(this.span, error)
        }
    }

    private removeError() {
        if (this.span === undefined) return;
        this.dom.removeChild(this.span);
        this.span = undefined;
    }

    private keyDownHandle = (e: KeyboardEvent) => {
        this.removeError();
        this.callback(this.view, e);
    };
}
