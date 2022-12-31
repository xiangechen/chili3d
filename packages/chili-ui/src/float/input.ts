// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "chili-shared";
import { IView } from "chili-vis";
import { Div, TextBlock, TextBox } from "../controls";
import style from "./input.module.css";

export class Input extends Div implements IDisposable {
    private readonly textbox: TextBox;
    private textblock?: TextBlock;
    constructor(readonly view: IView, readonly callback: (view: IView, e: KeyboardEvent) => void) {
        super(style.panel);
        this.textbox = new TextBox();
        this.add(this.textbox);
        this.textbox.dom.addEventListener("keydown", this.keyDownHandle);
    }

    get text(): string {
        return this.textbox.text;
    }

    focus() {
        this.textbox.dom.focus();
    }

    dispose(): void | Promise<void> {
        this.textbox.dom.removeEventListener("keydown", this.keyDownHandle);
    }

    showError(error: string) {
        if (this.textblock === undefined) {
            this.textblock = new TextBlock(error, style.error);
            this.add(this.textblock);
        } else {
            this.textblock.text = error;
        }
    }

    private removeError() {
        if (this.textblock === undefined) return;
        this.remove(this.textblock);
        this.textblock = undefined;
    }

    private keyDownHandle = (e: KeyboardEvent) => {
        this.removeError();
        this.callback(this.view, e);
    };
}
