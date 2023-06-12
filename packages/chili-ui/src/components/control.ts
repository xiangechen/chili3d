// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable, IPropertyChanged, PropertyChangedHandler } from "chili-core";

export abstract class Control extends HTMLElement implements IDisposable {
    private onConnectedCallbacks: (() => void)[] = [];
    private onDisconnectedCallbacks: (() => void)[] = [];

    protected readonly propertyHandlers: [IPropertyChanged, PropertyChangedHandler<any, any>][] = [];

    constructor(className?: string) {
        super();
        if (className) {
            this.className = className;
        }
    }

    setTitle(title: string) {
        this.title = title;
        return this;
    }

    setId(id: string) {
        this.id = id;
        return this;
    }

    addStyle(key: keyof CSSStyleDeclaration, value: string) {
        this.style[key as any] = value;
        return this;
    }

    addClass(...classes: string[]) {
        this.classList.add(...classes);
        return this;
    }

    removeClass(...classes: string[]) {
        this.classList.remove(...classes);
        return this;
    }

    connectedCallback() {
        this.propertyHandlers.forEach((x) => x[0].onPropertyChanged(x[1]));
        this.onConnectedCallbacks.forEach((x) => x());
    }

    onConnectedCallback(callback: () => void): this {
        this.onConnectedCallbacks.push(callback);
        return this;
    }

    disconnectedCallback() {
        this.propertyHandlers.forEach((x) => x[0].removePropertyChanged(x[1]));
        this.onDisconnectedCallbacks.forEach((x) => x());
    }

    onDisconnectedCallback(callback: () => void): this {
        this.onDisconnectedCallbacks.push(callback);
        return this;
    }

    clearChildren() {
        while (this.lastElementChild) {
            this.removeChild(this.lastElementChild);
        }
    }

    dispose(): void | Promise<void> {
        this.propertyHandlers.length = 0;
        this.onConnectedCallbacks.length = 0;
        this.onDisconnectedCallbacks.length = 0;
    }
}
