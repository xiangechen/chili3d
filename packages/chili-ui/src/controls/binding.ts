// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "chili-core";

export class Binding implements IDisposable {
    static #bindins = new WeakMap<any, Set<Binding>>();
    #cache = new Set<[any, string | number | symbol]>();

    constructor(readonly dataContext: any, readonly path: string | number | symbol) {
        this.dataContext.onPropertyChanged?.(this.onPropertyChanged);
        this.cacheBinding(dataContext);
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

    add<T>(target: T, key: keyof T) {
        this.#cache.add([target, key]);
        target[key] = this.dataContext[this.path];
    }

    remove<T>(target: T, key: keyof T) {
        this.#cache.delete([target, key]);
    }

    private onPropertyChanged = (prop: string) => {
        if (prop === this.path) {
            this.#cache.forEach(([target, key]) => {
                target[key] = this.dataContext[this.path];
            });
        }
    };

    dispose() {
        this.dataContext.removePropertyChanged?.(this.onPropertyChanged);
        this.#cache.clear();
    }
}

export function bind<T>(dataContext: T, path: keyof T) {
    return new Binding(dataContext, path);
}
