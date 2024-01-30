// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, IDisposable, IPropertyChanged } from "chili-core";

export class Binding<T extends IPropertyChanged = IPropertyChanged> implements IDisposable {
    private _targets: [element: WeakRef<object>, property: any][] = [];

    constructor(
        public readonly source: T,
        public readonly path: keyof T,
        public readonly converter?: IConverter,
    ) {}

    setBinding<U extends object>(element: U, property: keyof U) {
        this._targets.push([new WeakRef(element), property]);
        this.setValue<U>(element, property);
    }

    startObserver() {
        this.source.onPropertyChanged(this._onPropertyChanged);
    }

    stopObserver() {
        this.source.removePropertyChanged(this._onPropertyChanged);
    }

    private _onPropertyChanged = (property: keyof T) => {
        if (property === this.path) {
            let newItems = [],
                changed = false;
            for (let item of this._targets) {
                let element = item[0].deref();
                if (element) {
                    this.setValue(element, item[1]);
                    newItems.push(item);
                } else {
                    changed = true;
                }
            }
            if (changed) this._targets = newItems;
        }
    };

    private setValue<U extends object>(element: U, property: PropertyKey) {
        let value: any = this.source[this.path];
        if (this.converter) {
            let result = this.converter.convert(value);
            if (!result.success) {
                throw new Error(`Cannot convert value ${value}`);
            }
            value = result.getValue();
        }
        (element as any)[property] = value;
    }

    dispose(): void {
        this.stopObserver();
        this._targets.length = 0;
    }
}
