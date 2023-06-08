// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, MessageType, PubSub, Result } from "chili-core";
import { Control } from "../control";
import style from "./flyout.module.css";
import { Input } from "./input";
import { Tip } from "./tip";

export class Flyout extends Control {
    private _tip: Tip | undefined;
    private _input: Input | undefined;
    private lastFocus: HTMLElement | null = null;

    constructor() {
        super(style.root);

        PubSub.default.sub("showFloatTip", this.showTip);
        PubSub.default.sub("clearFloatTip", this.clearTip);
        PubSub.default.sub("showInput", this.displayInput);
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

    private displayInput = (handler: (text: string) => Result<undefined, keyof I18n>) => {
        if (this._input === undefined) {
            this.lastFocus = document.activeElement as HTMLElement;
            this._input = new Input(handler);
            this._input.onCancelled(this.clearInput);
            this._input.onCompleted(this.clearInput);
            this.append(this._input);
            this._input.focus();
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
