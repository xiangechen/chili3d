// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Property } from "chili-core";
import { RibbonButton } from "./ribbonButton";
import { RibbonButtonSize } from "./ribbonButtonSize";
import style from "./ribbonToggleButton.module.css";

export class RibbonToggleButton extends RibbonButton {
    constructor(readonly source: any, readonly property: Property, size: RibbonButtonSize) {
        super(property.display, property.icon!, size, () => {
            source[property.name] = !source[property.name];
        });
        this.setCheckedStyle(source[property.name]);
        source.onPropertyChanged(this.onPropertyChanged);
    }

    private onPropertyChanged = (s: any, prop: string) => {
        if (prop !== this.property.name) return;
        this.setCheckedStyle(this.source[prop]);
    };

    private setCheckedStyle(isChecked: boolean) {
        if (isChecked) {
            this.classList.add(style.checked);
        } else {
            this.classList.remove(style.checked);
        }
    }
}

customElements.define("ribbon-toggle-button", RibbonToggleButton);
