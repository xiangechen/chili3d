// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, IDisposable, IPropertyChanged } from "chili-core";
import { Binding } from "./binding";

export abstract class BindableElement extends HTMLElement implements IDisposable {
    readonly #bindings: Binding<any>[] = [];

    bind<T extends IPropertyChanged>(dataContext: T, path: keyof T, converter?: IConverter) {
        let binding = new Binding(dataContext, path, converter);
        this.#bindings.push(binding);
        return binding;
    }

    connectedCallback() {
        this.#bindings.forEach((binding) => binding.startObserver());
    }

    disconnectedCallback() {
        this.#bindings.forEach((binding) => binding.stopObserver());
    }

    dispose(): void {
        this.#bindings.forEach((binding) => binding.dispose());
        this.#bindings.length = 0;
    }
}
