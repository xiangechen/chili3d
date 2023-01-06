// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "chili-core";
import { i18n, I18n, MessageLevel, Result, Valid, XYZ } from "chili-shared";
import { Control } from "../control";
import { UI } from "../ui";
import style from "./float.module.css";
import { Input } from "./input";
import { Tip } from "./tip";

export class FloatContainer {
    readonly dom: HTMLDivElement;
    private _tip: Tip | undefined;
    private _input: Input | undefined;

    constructor() {
        this.dom = Control.div(style.floatContainer);

        PubSub.default.sub("floatTip", this.showTip);
        PubSub.default.sub("clearFloatTip", this.clearTip);
        PubSub.default.sub("showInput", this.showInput);
        PubSub.default.sub("clearInput", this.clearInput);
    }

    private showTip = (level: MessageLevel, msg: string) => {
        if (this._tip === undefined) {
            this._tip = new Tip(msg, level);
            this.dom.appendChild(this._tip.dom);
        } else {
            this._tip.set(msg, level);
        }
    };

    private clearTip = () => {
        if (this._tip !== undefined) {
            this.dom.removeChild(this._tip.dom);
            this._tip = undefined;
        }
    };

    private showInput = (validCallback: (text: string) => Valid, callback: (text: string) => void) => {
        if (this._input === undefined) {
            this._input = new Input((e) => this.handleInput(e, validCallback, callback));
            this.dom.appendChild(this._input.dom);
            this._input.focus();
        }
    };

    private handleInput = (
        e: KeyboardEvent,
        validCallback: (text: string) => Valid,
        callback: (text: string) => void
    ) => {
        if (e.key === "Enter") {
            let text = this._input!.text;
            let inputValue = validCallback(text);
            if (inputValue.isOk) {
                this.clearInput();
                callback(text);
            } else {
                this._input!.showError(inputValue.error!);
            }
        } else if (e.key === "Escape") {
            this.clearInput();
        }
    };

    private clearInput = () => {
        if (this._input !== undefined) {
            this.dom.removeChild(this._input.dom);
            this._input.dispose();
            this._input = undefined;
            UI.instance.focus();
        }
    };
}
