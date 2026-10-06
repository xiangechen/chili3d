// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, type MessageType, PubSub, type Result, type ShowInputOptions } from "@chili3d/core";
import style from "./flyout.module.css";
import { Input } from "./input";
import { Tip } from "./tip";

export class Flyout extends HTMLElement {
    private _tip: HTMLElement | undefined;
    private _input: Input | undefined;
    private _onInputClose: (() => void) | undefined;
    private lastFocus: HTMLElement | null = null;

    constructor() {
        super();
        this.className = style.root;
    }

    connectedCallback(): void {
        PubSub.default.sub("showFloatTip", this.showTip);
        PubSub.default.sub("clearFloatTip", this.clearTip);
        PubSub.default.sub("showInput", this.displayInput);
        PubSub.default.sub("updateInput", this.updateInput);
        PubSub.default.sub("clearInput", this.clearInput);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("showFloatTip", this.showTip);
        PubSub.default.remove("clearFloatTip", this.clearTip);
        PubSub.default.remove("showInput", this.displayInput);
        PubSub.default.remove("updateInput", this.updateInput);
        PubSub.default.remove("clearInput", this.clearInput);
    }

    private readonly showTip = (dom: HTMLElement | { level: MessageType; msg: string }) => {
        if (dom instanceof HTMLElement) {
            this._tip?.remove();

            this._tip = dom;
            this.append(this._tip);
        } else if (this._tip instanceof Tip) {
            this._tip.set(dom.msg, dom.level);
        } else {
            this._tip?.remove();

            this._tip = new Tip(dom.msg, dom.level);
            this.append(this._tip);
        }
    };

    private readonly clearTip = () => {
        if (this._tip !== undefined) {
            this._tip.remove();
            this._tip = undefined;
        }
    };

    private readonly displayInput = (
        text: string,
        handler: (text: string) => Result<string, I18nKeys>,
        options?: ShowInputOptions,
    ) => {
        // a box asked for while one is up replaces it: the new request is the fresher
        // intent (a digit opening the numeric box over a drag's lingering readout, say),
        // and the old box hears about it through its own onClose
        this.clearInput();
        this.lastFocus = document.activeElement as HTMLElement;
        this._input = new Input(text, handler);
        this._input.onCancelled(this.clearInput);
        this._input.onCompleted(this.clearInput);
        this._onInputClose = options?.onClose;
        this.append(this._input);
        setTimeout(() => {
            // a readout leaves the keys where they are: nothing to focus, nothing to select
            if (options?.takeFocus === false) return;
            this._input?.focus();
            if (options?.selectAll) this._input?.selectAll();
        });
    };

    private readonly updateInput = (text: string) => {
        this._input?.setText(text);
    };

    private readonly clearInput = () => {
        if (this._input !== undefined) {
            this.removeChild(this._input);
            this._input.dispose();
            this._input = undefined;
            const onClose = this._onInputClose;
            this._onInputClose = undefined;
            onClose?.();
            this.lastFocus?.focus();
        }
    };
}

customElements.define("chili-flyout", Flyout);
