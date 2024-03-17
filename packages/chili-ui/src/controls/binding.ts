// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, IDisposable, IPropertyChanged } from "chili-core";

export class Binding<T extends IPropertyChanged = any> implements IDisposable {
    private _targets: [element: WeakRef<object>, property: any][] = [];

    constructor(
        readonly source: T,
        readonly path: keyof T,
        readonly converter?: IConverter,
    ) {}

    setBinding<U extends object>(element: U, property: keyof U) {
        this._targets.push([new WeakRef(element), property]);
        this.setValue<U>(element, property);
        this.source.onPropertyChanged(this._onPropertyChanged);
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
        let value: any = this.getPropertyValue();
        (element as any)[property] = value;
    }

    getPropertyValue() {
        let value: any = this.source[this.path];
        if (this.converter) {
            let result = this.converter.convert(value);
            if (!result.success) {
                throw new Error(`Cannot convert value ${value}`);
            }
            value = result.getValue();
        }
        return value;
    }

    dispose(): void {
        this.source.removePropertyChanged(this._onPropertyChanged);
        this._targets.length = 0;
    }
}
