// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { IDisposable } from "./disposable";
import { IEqualityComparer } from "./equalityComparer";
import { PropertyHistoryRecord } from "./history";
import { Transaction } from "./transaction";

export type PropertyChangedHandler<T, K extends keyof T> = (property: K, source: T, oldValue: T[K]) => void;

export interface IPropertyChanged extends IDisposable {
    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void;
    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void;
    clearPropertyChanged(): void;
}

const DEFAULT_VALUE = Symbol.for("DEFAULT_VALUE");

export class Observable implements IPropertyChanged {
    protected readonly propertyChangedHandlers: Set<PropertyChangedHandler<any, any>> = new Set();

    private getPrivateKey<K extends keyof this>(pubKey: K) {
        return `_${String(pubKey)}`;
    }

    protected getPrivateValue<K extends keyof this>(
        pubKey: K,
        defaultValue: this[K] = DEFAULT_VALUE as any,
    ): this[K] {
        let privateKey = this.getPrivateKey(pubKey);
        if (privateKey in this) {
            return (this as any)[privateKey];
        } else if (defaultValue !== DEFAULT_VALUE) {
            this.defineProtoProperty(pubKey, privateKey, defaultValue);
            return defaultValue;
        } else {
            throw new Error(`property ${privateKey} dose not exist in ${this.constructor.name}`);
        }
    }

    protected setPrivateValue<K extends keyof this>(pubKey: K, newValue: this[K]): void {
        let privateKey = this.getPrivateKey(pubKey);
        if (privateKey in this) {
            (this as any)[privateKey] = newValue;
            return;
        }

        this.defineProtoProperty(pubKey, privateKey, newValue);
    }

    private defineProtoProperty<K extends keyof this>(
        pubKey: K,
        privateKey: string,
        newValue: this[K],
    ): void {
        let proto = Object.getPrototypeOf(this);
        while (proto !== null) {
            if (proto.hasOwnProperty(pubKey)) {
                Object.defineProperty(proto, privateKey, {
                    value: newValue,
                    writable: true,
                    enumerable: false,
                    configurable: true,
                });
                break;
            }
            proto = Object.getPrototypeOf(proto);
        }
    }

    /**
     * Set the value of a private property, and if successful, execute emitPropertyChanged.
     *
     * Note: The private property name must be the public property name with the prefix _, i.e., age->_age(private property name).
     */
    protected setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]>,
    ): boolean {
        let oldValue = this[property];
        if (this.isEuqals(oldValue, newValue, equals)) return false;
        this.setPrivateValue(property, newValue);
        onPropertyChanged?.(property, oldValue);
        this.emitPropertyChanged(property, oldValue);
        return true;
    }

    private isEuqals<K extends keyof this>(
        oldValue: this[K],
        newValue: this[K],
        equals?: IEqualityComparer<this[K]>,
    ): boolean {
        if (equals !== undefined) {
            return equals.equals(oldValue, newValue);
        } else {
            return oldValue === newValue;
        }
    }

    protected emitPropertyChanged<K extends keyof this>(property: K, oldValue: this[K]) {
        this.propertyChangedHandlers.forEach((callback) => callback(property, this, oldValue));
    }

    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>) {
        this.propertyChangedHandlers.add(handler);
    }

    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>) {
        this.propertyChangedHandlers.delete(handler);
    }

    clearPropertyChanged(): void {
        this.propertyChangedHandlers.clear();
    }

    dispose() {
        this.propertyChangedHandlers.clear();
    }
}

export abstract class HistoryObservable extends Observable {
    constructor(readonly document: IDocument) {
        super();
    }

    protected override setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]> | undefined,
    ): boolean {
        return super.setProperty(
            property,
            newValue,
            (property, oldValue) => {
                onPropertyChanged?.(property, oldValue);
                Transaction.add(
                    this.document,
                    this.document.history,
                    new PropertyHistoryRecord(this, property, oldValue, newValue),
                );
            },
            equals,
        );
    }
}
