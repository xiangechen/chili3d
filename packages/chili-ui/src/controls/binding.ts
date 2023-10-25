// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, IDisposable, IPropertyChanged } from "chili-core";

export class Binding<T extends IPropertyChanged = IPropertyChanged> implements IDisposable {
    readonly #targets: [element: any, property: any][] = [];

    constructor(
        public readonly source: T,
        public readonly path: keyof T,
        public readonly converter?: IConverter,
    ) {}

    bindTo<U>(element: U, property: keyof U) {
        this.#targets.push([element, property]);
        this.setValue<U>(element, property);
    }

    startObserver() {
        this.source.onPropertyChanged(this.#onPropertyChanged);
    }

    stopObserver() {
        this.source.removePropertyChanged(this.#onPropertyChanged);
    }

    #onPropertyChanged = (property: keyof T) => {
        if (property === this.path) {
            for (let [element, property] of this.#targets) {
                this.setValue(element, property);
            }
        }
    };

    private setValue<U>(element: U, property: keyof U) {
        let value: any = this.source[this.path];
        if (this.converter) {
            let result = this.converter.convert(value);
            if (!result.success) {
                throw new Error(`Cannot convert value ${value}`);
            }
            value = result.getValue();
        }
        element[property] = value;
    }

    dispose(): void {
        this.stopObserver();
        this.#targets.length = 0;
    }
}
