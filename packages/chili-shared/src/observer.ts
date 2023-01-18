// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { EventEmitter } from "events";
import { IDisposable } from "chili-shared";

const PropertyChangedEvent = "PropertyChangedEvent";
const CollectionChangedEvent = "CollectionChangedEvent";

export interface PropertyChangedHandler<T, K extends keyof T> {
    (source: T, property: K, oldValue: T[K], newValue: T[K]): void;
}

export interface CollectionChangedHandler<T> {
    (source: ICollection<T>, action: CollectionAction, item: T): void;
}

export interface IPropertyChanged {
    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void;
    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void;
}

export enum CollectionAction {
    add,
    remove,
}

export interface ICollectionChanged<T> {
    onCollectionChanged<T>(handler: CollectionChangedHandler<T>): void;
    removeCollectionChanged<T>(handler: CollectionChangedHandler<T>): void;
}

export class Observable implements IPropertyChanged, IDisposable {
    protected readonly eventEmitter: EventEmitter;

    constructor() {
        this.eventEmitter = new EventEmitter();
    }

    protected privateKeyMap(pubKey: string) {
        return `_${pubKey}`;
    }

    /**
     * Checks if a property already matches a desired value. Sets the property and notifies listeners only when necessary.
     */
    protected setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (oldValue: this[K], newValue: this[K]) => void
    ): boolean {
        let priKey = this.privateKeyMap(String(property));
        let obj = this as unknown as any;
        let oldValue = obj[priKey];
        if (oldValue === newValue) return false;
        obj[priKey] = newValue;
        if (onPropertyChanged) onPropertyChanged(oldValue, newValue);
        this.emitPropertyChanged(property as any, oldValue, newValue);
        return true;
    }

    protected emitPropertyChanged<K extends keyof this>(property: K, oldValue: this[K], newValue: this[K]) {
        this.eventEmitter.emit(PropertyChangedEvent, this, property, oldValue, newValue);
    }

    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>) {
        this.eventEmitter.on(PropertyChangedEvent, handler);
    }

    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>) {
        this.eventEmitter.off(PropertyChangedEvent, handler);
    }

    dispose() {
        this.eventEmitter.eventNames().forEach((x) => {
            this.eventEmitter.removeAllListeners(x);
        });
    }
}

export interface ICollection<T> {
    add(item: T): void;
    entry(): IterableIterator<T>;
    remove(item: T): void;
    size(): number;
    find(predicate: (item: T) => boolean): T | undefined;
}

export abstract class CollectionChangedBase<T> implements ICollectionChanged<T>, IDisposable {
    protected readonly _eventEmitter: EventEmitter;

    constructor() {
        this._eventEmitter = new EventEmitter();
    }

    dispose(): void | Promise<void> {
        this._eventEmitter.eventNames().forEach((x) => {
            this._eventEmitter.removeAllListeners(x);
        });
    }

    onCollectionChanged<T>(handler: CollectionChangedHandler<T>): void {
        this._eventEmitter.on(CollectionChangedEvent, handler);
    }

    removeCollectionChanged<T>(handler: CollectionChangedHandler<T>): void {
        this._eventEmitter.off(CollectionChangedEvent, handler);
    }

    protected emitCollectionChanged<T>(action: CollectionAction, item: T) {
        this._eventEmitter.emit(CollectionChangedEvent, this, action, item);
    }
}

export class ObservableCollection<T> extends CollectionChangedBase<T> implements ICollection<T> {
    private readonly _array: Array<T>;

    constructor() {
        super();
        this._array = [];
    }

    add(item: T): boolean {
        if (this._array.indexOf(item) > -1) return false;
        this._array.push(item);
        this.emitCollectionChanged(CollectionAction.add, item);
        return true;
    }

    remove(item: T): boolean {
        let index = this._array.indexOf(item);
        if (index > -1) {
            this._array.splice(index, 1);
            this.emitCollectionChanged(CollectionAction.remove, item);
            return true;
        }
        return false;
    }

    find(predicate: (item: T) => boolean): T | undefined {
        for (let index = 0; index < this._array.length; index++) {
            if (predicate(this._array[index])) return this._array[index];
        }
        return undefined;
    }

    entry(): IterableIterator<T> {
        return this._array.values();
    }

    size(): number {
        return this._array.length;
    }
}
