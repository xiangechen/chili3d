// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter } from "./converter";
import { IPropertyChanged } from "./observer";

const registry = new FinalizationRegistry((binding: PathBinding<IPropertyChanged>) => {
    binding.removeBinding();
});

/**
 * Bind the property chain as a path, separated by dots
 *
 * @example
 * ```ts
 * const binding = new PathBinding(source, "a.b.c");
 * binding.setBinding(element, "property");
 * ```
 */
export class PathBinding<T extends IPropertyChanged = IPropertyChanged> {
    private _target?: {
        element: WeakRef<object>;
        property: PropertyKey;
    };
    private _oldPathObjects?: { source: IPropertyChanged; property: string }[];
    private _actualSource?: {
        source: IPropertyChanged;
        property: string;
    };

    constructor(
        readonly source: T,
        readonly path: string,
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

        registry.register(element, this);
        this.addPropertyChangedHandler();
    }

    removeBinding() {
        let element = this._target?.element.deref();
        if (element) {
            registry.unregister(element);
        }
        this._target = undefined;

        this.removePropertyChangedHandler();
    }

    private readonly handleAllPathPropertyChanged = (property: string, source: any) => {
        if (!this.shouldUpdateHandler(property, source)) {
            return;
        }

        this.removePropertyChangedHandler();
        this.addPropertyChangedHandler();
    };

    private readonly handlePropertyChanged = (property: string, source: any) => {
        if (this.path.endsWith(property) && this._target) {
            this.setValue(source, property);
        }
    };

    private shouldUpdateHandler(property: string, source: any) {
        if (this._oldPathObjects === undefined) {
            return true;
        }

        for (const element of this._oldPathObjects) {
            if (element.property === property && element.source === source) {
                return true;
            }
        }

        if (!this._actualSource) {
            return this.path.includes(property);
        }

        return false;
    }

    private addPropertyChangedHandler() {
        let props = this.path.split(".");
        let source: any = this.source;
        this._oldPathObjects = [];
        for (let i = 0; i < props.length; i++) {
            if (!source || !(props[i] in source)) {
                break;
            }

            let sourceProperty = { source, property: props[i] };

            if (i === props.length - 1) {
                this.setValue(source, props[i]);
                this._actualSource = sourceProperty;
                source.onPropertyChanged(this.handlePropertyChanged);
                break;
            }

            source.onPropertyChanged(this.handleAllPathPropertyChanged);
            this._oldPathObjects.push(sourceProperty);

            source = source[props[i]];
        }
    }

    private removePropertyChangedHandler() {
        if (!this._oldPathObjects) {
            return;
        }

        for (const element of this._oldPathObjects) {
            element.source.removePropertyChanged(this.handleAllPathPropertyChanged);
        }

        if (this._actualSource) {
            this._actualSource.source.removePropertyChanged(this.handlePropertyChanged);
        }

        this._actualSource = undefined;
        this._oldPathObjects = undefined;
    }

    private setValue(source: any, property: string) {
        if (!this._target) return;

        let element = this._target.element.deref();
        if (!element) {
            return;
        }

        let value = source[property];
        if (this.converter) {
            let converted = this.converter.convert(value);
            if (converted.isOk) {
                (element as any)[this._target.property] = converted.value;
            }
        } else {
            (element as any)[this._target.property] = value;
        }
    }

    getPropertyValue() {
        if (!this._actualSource) {
            return undefined;
        }

        return (this._actualSource.source as any)[this._actualSource.property];
    }
}

export class Binding<T extends IPropertyChanged = IPropertyChanged> extends PathBinding<T> {
    constructor(source: T, path: keyof T, converter?: IConverter) {
        super(source, path.toString(), converter);
    }
}
