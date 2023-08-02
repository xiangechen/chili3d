// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n } from "chili-core";
import { RibbonButton } from "./ribbonButton";
import { RibbonButtonSize } from "./ribbonButtonSize";
import style from "./ribbonToggleButton.module.css";

export class RibbonToggleButton extends RibbonButton {
    private _isChecked: boolean = false;
    get isChecked() {
        return this._isChecked;
    }
    set isChecked(value: boolean) {
        this._isChecked = value;
        if (this._isChecked) {
            this.classList.add(style.checked);
        } else {
            this.classList.remove(style.checked);
        }
    }

    constructor(
        display: keyof I18n,
        icon: string,
        size: RibbonButtonSize,
        isChecked: boolean,
        click: () => void
    ) {
        super(display, icon, size, () => {
            click();
            this.isChecked = !this.isChecked;
        });
        this.isChecked = isChecked;
    }
}

customElements.define("ribbon-toggle-button", RibbonToggleButton);
