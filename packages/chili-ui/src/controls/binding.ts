// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, IDisposable, IPropertyChanged } from "chili-core";

const bingings = new Set<Binding<any>>();

setInterval(
    () => {
        console.debug("before update", bingings.size);
        bingings.forEach((binding) => {
            binding.updateBindings();
            if (!binding.isListening) {
                bingings.delete(binding);
            }
        });
        console.debug("after update", bingings.size);
    },
    1000 * 60 * 3,
);

export class Binding<T extends IPropertyChanged = any> implements IDisposable {
    private _targets: [element: WeakRef<object>, property: any][] = [];
    private _isListening = false;
    public get isListening() {
        return this._isListening;
    }

    constructor(
        readonly source: T,
        readonly path: keyof T,
        readonly converter?: IConverter,
    ) {}

    updateBindings() {
        let newItems = [];
        for (let item of this._targets) {
            let element = item[0].deref();
            if (element) newItems.push(item);
        }
        this._targets.length = 0;
        this._targets = newItems;
        if (this._targets.length === 0) {
            this._isListening = false;
            this.source.removePropertyChanged(this._onPropertyChanged);
        }
    }

    setBinding<U extends object>(element: U, property: keyof U) {
        this._targets.push([new WeakRef(element), property]);
        this.setValue<U>(element, property);
        if (!this._isListening) {
            this._isListening = true;
            this.source.onPropertyChanged(this._onPropertyChanged);
            bingings.add(this);
        }
    }

    private _onPropertyChanged = (property: keyof T) => {
        if (property === this.path) {
            let newItems = [];
            for (let item of this._targets) {
                let element = item[0].deref();
                if (element) {
                    this.setValue(element, item[1]);
                    newItems.push(item);
                }
            }
            this._targets = newItems;
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
