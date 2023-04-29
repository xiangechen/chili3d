// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Constants, I18n, i18n, IConverter, IPropertyChanged } from "chili-core";
import { Control } from "./control";
import style from "./label.module.css";

export class Label extends Control {
    constructor() {
        super(style.text);
    }

    text(text: string) {
        this.textContent = text;
        return this;
    }

    i18nText(key: keyof I18n) {
        this.textContent = i18n[key];
        this.dataset[Constants.I18nIdAttribute] = key;
        return this;
    }

    textBinding<T extends IPropertyChanged>(source: T, property: keyof T, converter?: IConverter) {
        this.textContent = this.convertToString<T>(source, property, converter);
        this.propertyHandlers.push([
            source,
            (source, p, oldValue, newValue) => {
                if (property === p) {
                    this.textContent = newValue;
                }
            },
        ]);
        return this;
    }

    private convertToString<T extends IPropertyChanged>(
        source: T,
        property: keyof T,
        converter?: IConverter
    ): string | null {
        return converter?.convert(source[property]).value ?? String(source[property]);
    }
}

customElements.define("chili-label", Label);
