// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18nKeys, MessageType, PubSub, Result } from "chili-core";
import style from "./flyout.module.css";
import { Input } from "./input";
import { Tip } from "./tip";

export class Flyout extends HTMLElement {
    private _tip: Tip | undefined;
    private _input: Input | undefined;
    private lastFocus: HTMLElement | null = null;

    constructor() {
        super();
        this.className = style.root;
    }

    connectedCallback(): void {
        PubSub.default.sub("showFloatTip", this.showTip);
        PubSub.default.sub("clearFloatTip", this.clearTip);
        PubSub.default.sub("showInput", this.displayInput);
        PubSub.default.sub("clearInput", this.clearInput);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("showFloatTip", this.showTip);
        PubSub.default.remove("clearFloatTip", this.clearTip);
        PubSub.default.remove("showInput", this.displayInput);
        PubSub.default.remove("clearInput", this.clearInput);
    }

    private readonly showTip = (level: MessageType, msg: string) => {
        if (this._tip === undefined) {
            this._tip = new Tip(msg, level);
            this.append(this._tip);
        } else {
            this._tip.set(msg, level);
        }
    };

    private readonly clearTip = () => {
        if (this._tip !== undefined) {
            this._tip.remove();
            this._tip = undefined;
        }
    };

    private readonly displayInput = (text: string, handler: (text: string) => Result<string, I18nKeys>) => {
        if (this._input === undefined) {
            this.lastFocus = document.activeElement as HTMLElement;
            this._input = new Input(text, handler);
            this._input.onCancelled(this.clearInput);
            this._input.onCompleted(this.clearInput);
            this.append(this._input);
            this._input.focus();
        }
    };

    private readonly clearInput = () => {
        if (this._input !== undefined) {
            this.removeChild(this._input);
            this._input.dispose();
            this._input = undefined;
            this.lastFocus?.focus();
        }
    };
}

customElements.define("chili-flyout", Flyout);
