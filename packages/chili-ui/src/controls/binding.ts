// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, IDisposable, IPropertyChanged } from "chili-core";

const registry = new FinalizationRegistry((binding: Binding) => {
    binding.removeBinding();
});

export class Binding<T extends IPropertyChanged = any> implements IDisposable {
    private _targets?: [element: WeakRef<object>, property: any];

    constructor(
        readonly source: T,
        readonly path: keyof T,
        readonly converter?: IConverter,
    ) {}

    setBinding<U extends object>(element: U, property: keyof U) {
        if (this._targets) {
            throw new Error("Binding already set");
        }
        this._targets = [new WeakRef(element), property];
        this.setValue<U>(element, property);
        this.source.onPropertyChanged(this._onPropertyChanged);
        registry.register(element, this);
    }

    removeBinding() {
        this._targets = undefined;
        this.source.removePropertyChanged(this._onPropertyChanged);
    }

    private _onPropertyChanged = (property: keyof T) => {
        if (property === this.path && this._targets) {
            let element = this._targets[0].deref();
            if (element) {
                this.setValue(element, this._targets[1]);
            }
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
        this._targets = undefined;
    }
}
