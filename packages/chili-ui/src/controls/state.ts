import { IPropertyChanged, PropertyChangedHandler } from "chili-core";
import { Binding } from "./binding";

export class State<T> implements IPropertyChanged {
    #handlers: PropertyChangedHandler<any, any>[] = [];

    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void {
        this.#handlers.push(handler);
    }

    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void {
        const index = this.#handlers.indexOf(handler);
        if (index !== -1) {
            this.#handlers.splice(index, 1);
        }
    }

    #value: T;
    get value(): T {
        return this.#value;
    }
    set value(newValue: T) {
        if (newValue === this.#value) return;
        const oldValue = this.#value;
        this.#value = newValue;
        this.#handlers.forEach((handler) => handler("value", this, oldValue));
    }

    constructor(initialValue: T) {
        this.#value = initialValue;
    }
}

export function useState<T>(initialValue: T): [Binding<State<T>, "value">, (newValue: T) => void] {
    const state = new State(initialValue);
    const setState = (newValue: T) => (state.value = newValue);
    return [new Binding(state, "value"), setState];
}
