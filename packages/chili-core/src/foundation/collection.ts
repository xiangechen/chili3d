// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable } from "./disposable";

export enum CollectionAction {
    add,
    remove,
    move,
    replace,
}

export type CollectionChangedArgs =
    | {
          action: CollectionAction.add;
          items: any[];
      }
    | {
          action: CollectionAction.remove;
          items: any[];
      }
    | {
          action: CollectionAction.move;
          from: number;
          to: number;
      }
    | {
          action: CollectionAction.replace;
          item: any;
          items: any[];
      };

export interface ICollectionChanged {
    onCollectionChanged(callback: (args: CollectionChangedArgs) => void): void;
    removeCollectionChanged(callback: (args: CollectionChangedArgs) => void): void;
}

export class ObservableCollection<T> implements ICollectionChanged, IDisposable {
    private readonly _callbacks: Set<(args: CollectionChangedArgs) => void> = new Set();
    private _items: T[];

    constructor(...items: T[]) {
        this._items = [...items];
    }

    push(...items: T[]) {
        this._items.push(...items);
        this._callbacks.forEach((callback) =>
            callback({
                action: CollectionAction.add,
                items,
            }),
        );
    }

    remove(...items: T[]) {
        this._items = this._items.filter((item) => !items.includes(item));
        this._callbacks.forEach((callback) =>
            callback({
                action: CollectionAction.remove,
                items,
            }),
        );
    }

    move(from: number, to: number) {
        let canMove =
            from !== to && from >= 0 && from < this._items.length && to >= 0 && to < this._items.length;
        if (!canMove) {
            return;
        }

        let items = this._items.splice(from, 1);
        this._items.splice(from < to ? to - 1 : to, 0, ...items);
        this._callbacks.forEach((callback) =>
            callback({
                action: CollectionAction.move,
                from,
                to,
            }),
        );
    }

    clear() {
        let items = this._items;
        this._items = [];
        this._callbacks.forEach((callback) =>
            callback({
                action: CollectionAction.remove,
                items,
            }),
        );
    }

    get length() {
        return this._items.length;
    }

    replace(index: number, ...items: T[]) {
        if (index < 0 || index >= this._items.length) {
            return;
        }

        let item = this._items[index];
        this._items.splice(index, 1, ...items);
        this._callbacks.forEach((callback) =>
            callback({
                action: CollectionAction.replace,
                item,
                items,
            }),
        );
    }

    forEach(callback: (item: T, index: number) => void) {
        this.items.forEach(callback);
    }

    map(callback: (item: T, index: number) => any) {
        return this.items.map(callback);
    }

    get items() {
        return [...this._items];
    }

    [Symbol.iterator]() {
        return this.items[Symbol.iterator]();
    }

    item(index: number) {
        return this._items[index];
    }

    at(index: number) {
        return this._items.at(index);
    }

    filter(predicate: (value: T, index: number, array: T[]) => boolean) {
        return this._items.filter(predicate);
    }

    find(predicate: (value: T, index: number, array: T[]) => boolean) {
        return this._items.find(predicate);
    }

    indexOf(item: T, fromIndex: number | undefined) {
        return this._items.indexOf(item, fromIndex);
    }

    contains(item: T) {
        return this._items.indexOf(item) !== -1;
    }

    get count() {
        return this._items.length;
    }

    onCollectionChanged(callback: (args: CollectionChangedArgs) => void): void {
        this._callbacks.add(callback);
    }

    removeCollectionChanged(callback: (args: CollectionChangedArgs) => void): void {
        this._callbacks.delete(callback);
    }

    dispose() {
        this._callbacks.clear();
        this._items.length = 0;
    }
}

export enum SelectMode {
    check,
    radio,
    combo,
}

export class SelectableItems<T> {
    readonly items: ReadonlyArray<T>;
    selectedItems: Set<T>;

    get selectedIndexes(): number[] {
        let indexes: number[] = [];
        this.selectedItems.forEach((x) => {
            let index = this.items.indexOf(x);
            if (index > -1) {
                indexes.push(index);
            }
        });
        return indexes;
    }

    firstSelectedItem() {
        return this.selectedItems.values().next().value;
    }

    constructor(
        items: T[],
        readonly mode: SelectMode = SelectMode.radio,
        selectedItems?: T[],
    ) {
        this.items = items;
        this.selectedItems = new Set(selectedItems ?? []);
    }
}
