// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { TextBlock } from "../controls";
import style from "./tip.module.css";

export enum TipType {
    info,
    warn,
    error,
}

export class Tip extends TextBlock {
    private color?: string;

    constructor(msg: string, type: TipType) {
        super(msg, style.tip);
        this.set(msg, type);
    }

    set(msg: string, type: TipType) {
        if (this.text !== msg) {
            this.text = msg;
        }

        let old = this.color;
        this.color = style.info;
        if (type === TipType.error) this.color = style.error;
        else if (type === TipType.warn) this.color = style.warn;
        if (old !== this.color) {
            if (old !== undefined) this.removeClass(old);
            this.addClass(this.color);
        }
    }
}
