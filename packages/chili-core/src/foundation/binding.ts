// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter } from "./converter";
import { IPropertyChanged } from "./observer";

const registry = new FinalizationRegistry((binding: Binding) => {
    binding.removeBinding();
});

export class Binding<T extends IPropertyChanged = any> {
    private _target?: {
        element: WeakRef<object>;
        property: PropertyKey;
    };

    constructor(
        readonly source: T,
        readonly path: keyof T,
        readonly converter?: IConverter,
    ) {}

    setBinding<U extends object>(element: U, property: keyof U) {
        if (this._target) {
            throw new Error("Binding already set");
        }
        this._target = {
            element: new WeakRef(element),
            property,
        };

        this.setValue<U>(element, property);
        this.source.onPropertyChanged(this._onPropertyChanged);
        registry.register(element, this);
    }

    removeBinding() {
        let element = this._target?.element.deref();
        if (element) {
            registry.unregister(element);
        }
        this._target = undefined;
        this.source.removePropertyChanged(this._onPropertyChanged);
    }

    private _onPropertyChanged = (property: keyof T) => {
        if (property === this.path && this._target) {
            let element = this._target.element.deref();
            if (element) {
                this.setValue(element, this._target.property);
            }
        }
    };

    private setValue<U extends object>(element: U, property: PropertyKey) {
        let value = this.getPropertyValue();
        (element as any)[property] = value;
    }

    getPropertyValue() {
        let value: any = this.source[this.path];
        if (!this.converter) {
            return value;
        }

        let result = this.converter.convert(value);
        if (!result.isOk) {
            throw new Error(`Cannot convert value ${value}`);
        }
        return result.value;
    }
}
