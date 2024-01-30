// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter, IDisposable, IPropertyChanged } from "chili-core";
import { Binding } from "./binding";

export abstract class BindableElement extends HTMLElement implements IDisposable {
    private readonly _bindings: Binding<any>[] = [];

    bind<T extends IPropertyChanged>(dataContext: T, path: keyof T, converter?: IConverter): Binding {
        let binding = new Binding(dataContext, path, converter);
        this._bindings.push(binding);
        return binding as any;
    }

    connectedCallback() {
        this._bindings.forEach((binding) => binding.startObserver());
    }

    disconnectedCallback() {
        this._bindings.forEach((binding) => binding.stopObserver());
    }

    dispose(): void {
        this._bindings.forEach((binding) => binding.dispose());
        this._bindings.length = 0;
    }
}
