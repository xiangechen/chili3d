// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys, IConverter, IPropertyChanged } from "chili-core";
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

    i18nText(key: I18nKeys) {
        I18n.set(this, key);
        return this;
    }

    textBinding<T extends IPropertyChanged>(source: T, property: keyof T, converter?: IConverter) {
        this.textContent = this.convertToString<T>(source, property, converter);
        this.propertyHandlers.push([
            source,
            (p, source) => {
                if (property === p) {
                    this.textContent = source[p];
                }
            },
        ]);
        return this;
    }

    private convertToString<T extends IPropertyChanged>(
        source: T,
        property: keyof T,
        converter?: IConverter,
    ): string | null {
        let cvalue = converter?.convert(source[property]);
        return cvalue?.isOk ? cvalue.value : String(source[property]);
    }
}

customElements.define("chili-label", Label);
