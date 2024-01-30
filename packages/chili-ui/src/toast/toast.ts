// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys } from "chili-core";
import { label } from "../controls";
import style from "./toast.module.css";

export class Toast {
    private static _lastToast: [number, HTMLElement] | undefined;

    static show = (message: I18nKeys, ...args: any[]) => {
        if (this._lastToast) {
            clearTimeout(this._lastToast[0]);
            this._lastToast[1].remove();
        }

        const toast = label({ className: style.toast, textContent: I18n.translate(message, ...args) });
        document.body.appendChild(toast);
        this._lastToast = [
            window.setTimeout(() => {
                toast.remove();
                this._lastToast = undefined;
            }, 2000),
            toast,
        ];
    };
}
