// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IConverter, IDisposable } from "chili-core";

export type Key = string | number | symbol;

export type Mode = "one-way" | "two-way";

export class Binding implements IDisposable {
    static #bindins = new WeakMap<any, Set<Binding>>();
    #cache = new Set<[any, Key]>();

    constructor(
        readonly dataContext: any,
        readonly path: Key,
        readonly converter?: IConverter,
        readonly mode?: Mode
    ) {
        this.cacheBinding(dataContext);
        this.dataContext.onPropertyChanged?.(this.onPropertyChanged);
    }

    private cacheBinding(dataContext: any) {
        if (Binding.#bindins.has(dataContext)) {
            Binding.#bindins.get(dataContext)!.add(this);
        } else {
            Binding.#bindins.set(dataContext, new Set([this]));
        }
    }

    static removeBindings(dataContext: any) {
        if (Binding.#bindins.has(dataContext)) {
            Binding.#bindins.get(dataContext)!.forEach((binding) => binding.dispose());
            Binding.#bindins.delete(dataContext);
        }
    }

    add<T extends HTMLElement>(target: T, key: keyof T) {
        this.#cache.add([target, key]);
        this.setValue(target, key);
    }

    remove<T>(target: T, key: keyof T) {
        this.#cache.delete([target, key]);
    }

    private onPropertyChanged = (prop: string) => {
        if (prop === this.path) {
            this.#cache.forEach(([target, key]) => {
                this.setValue(target, key);
            });
        }
    };

    private setValue(target: any, key: Key) {
        let value = this.dataContext[this.path];
        if (this.converter) {
            value = this.converter.convert(value);
        }
        target[key] = value;
    }

    dispose() {
        this.dataContext.removePropertyChanged?.(this.onPropertyChanged);
        this.#cache.clear();
    }
}

export function bind<T>(dataContext: T, path: keyof T, converter?: IConverter, mode: Mode = "one-way") {
    return new Binding(dataContext, path, converter, mode);
}
