// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { MessageType, PubSub, Validation } from "chili-core";
import { Input } from "./input";
import { Tip } from "./tip";
import { Control } from "../control";

import style from "./flyout.module.css";

export class Flyout extends Control {
    private _tip: Tip | undefined;
    private _input: Input | undefined;
    private lastFocus: HTMLElement | null = null;

    constructor() {
        super(style.root);

        PubSub.default.sub("showFloatTip", this.showTip);
        PubSub.default.sub("clearFloatTip", this.clearTip);
        PubSub.default.sub("showInput", this.showInput);
        PubSub.default.sub("clearInput", this.clearInput);
    }

    private showTip = (level: MessageType, msg: string) => {
        if (this._tip === undefined) {
            this._tip = new Tip(msg, level);
            this.append(this._tip);
        } else {
            this._tip.set(msg, level);
        }
    };

    private clearTip = () => {
        if (this._tip !== undefined) {
            this.removeChild(this._tip);
            this._tip = undefined;
        }
    };

    private showInput = (validCallback: (text: string) => Validation, callback: (text: string) => void) => {
        if (this._input === undefined) {
            this._input = new Input((e) => this.handleInput(e, validCallback, callback));
            this.append(this._input);
            this.lastFocus = document.activeElement as HTMLElement;
            this._input.focus();
        }
    };

    private handleInput = (
        e: KeyboardEvent,
        validCallback: (text: string) => Validation,
        callback: (text: string) => void
    ) => {
        if (e.key === "Enter") {
            let text = this._input!.text;
            let inputValue = validCallback(text);
            if (inputValue.isOk) {
                this.clearInput();
                callback(text);
            } else {
                this._input!.showTip(inputValue.error!);
            }
        } else if (e.key === "Escape") {
            this.clearInput();
        }
    };

    private clearInput = () => {
        if (this._input !== undefined) {
            this.removeChild(this._input);
            this._input.dispose();
            this._input = undefined;
            this.lastFocus?.focus();
        }
    };
}

customElements.define("chili-flyout", Flyout);
