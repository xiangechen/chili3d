// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, MessageType } from "chili-core";

import { Control } from "../control";
import style from "./tip.module.css";

export class Tip {
    private color?: string;
    readonly dom: HTMLSpanElement;

    constructor(msg: string, type: MessageType) {
        this.dom = Control.textSpan(msg, style.tip);
        this.set(msg, type);
    }

    set(msg: string, type: MessageType) {
        if (this.dom.textContent !== msg) {
            this.dom.textContent = msg;
        }

        let old = this.color;
        this.color = style.info;
        if (type === MessageType.error) this.color = style.error;
        else if (type === MessageType.warn) this.color = style.warn;
        if (old !== this.color && this.color !== undefined) {
            if (old !== undefined) this.dom.classList.remove(old);
            this.dom.classList.add(this.color);
        }
    }
}
