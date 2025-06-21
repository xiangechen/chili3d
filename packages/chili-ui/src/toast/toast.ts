// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, I18nKeys } from "chili-core";
import { label } from "chili-controls";
import style from "./toast.module.css";

export class Toast {
    private static _lastToast: [number, HTMLElement] | undefined;

    static readonly info = (message: I18nKeys, ...args: any[]) => {
        Toast.display(style.info, I18n.translate(message, ...args));
    };

    static readonly error = (message: string) => {
        Toast.display(style.error, message);
    };

    static readonly warn = (message: string) => {
        Toast.display(style.warning, message);
    };

    private static display(type: string, message: string) {
        if (this._lastToast) {
            clearTimeout(this._lastToast[0]);
            this._lastToast[1].remove();
        }

        const toast = label({ className: `${style.toast} ${type}`, textContent: message });
        document.body.appendChild(toast);
        this._lastToast = [
            window.setTimeout(() => {
                toast.remove();
                this._lastToast = undefined;
            }, 2000),
            toast,
        ];
    }
}
