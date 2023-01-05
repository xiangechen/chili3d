// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "../control";
import style from "./tip.module.css";

export enum TipType {
    info,
    warn,
    error,
}

export class Tip {
    private color?: string;
    readonly dom: HTMLSpanElement;

    constructor(msg: string, type: TipType) {
        this.dom = Control.span(msg, style.tip);
        this.set(msg, type);
    }

    set(msg: string, type: TipType) {
        if (this.dom.textContent !== msg) {
            this.dom.textContent = msg;
        }

        let old = this.color;
        this.color = style.info;
        if (type === TipType.error) this.color = style.error;
        else if (type === TipType.warn) this.color = style.warn;
        if (old !== this.color) {
            if (old !== undefined) this.dom.classList.remove(old);
            this.dom.classList.add(this.color);
        }
    }
}
