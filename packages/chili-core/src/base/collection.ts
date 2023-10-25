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
    #callbacks: Set<(args: CollectionChangedArgs) => void> = new Set();
    #items: T[];

    constructor(items?: readonly T[]) {
        this.#items = items ? [...items] : [];
    }

    add(...items: T[]) {
        this.#items.push(...items);
        this.#callbacks.forEach((callback) =>
            callback({
                action: CollectionAction.add,
                items,
            }),
        );
    }

    remove(...items: T[]) {
        this.#items = this.#items.filter((item) => !items.includes(item));
        this.#callbacks.forEach((callback) =>
            callback({
                action: CollectionAction.remove,
                items,
            }),
        );
    }

    move(from: number, to: number) {
        if (from === to) return;
        if (from >= 0 && from < this.#items.length && to >= 0 && to < this.#items.length) {
            let items = this.#items.splice(from, 1);
            this.#items.splice(from < to ? to - 1 : to, 0, ...items);
            this.#callbacks.forEach((callback) =>
                callback({
                    action: CollectionAction.move,
                    from,
                    to,
                }),
            );
        }
    }

    clear() {
        let items = this.#items;
        this.#items = [];
        this.#callbacks.forEach((callback) =>
            callback({
                action: CollectionAction.remove,
                items,
            }),
        );
    }

    get length() {
        return this.#items.length;
    }

    replace(index: number, ...items: T[]) {
        if (index >= 0 && index < this.#items.length) {
            let item = this.#items[index];
            this.#items.splice(index, 1, ...items);
            this.#callbacks.forEach((callback) =>
                callback({
                    action: CollectionAction.replace,
                    item,
                    items,
                }),
            );
        }
    }

    get items() {
        return [...this.#items];
    }

    at(index: number) {
        return this.#items.at(index);
    }

    contains(item: T) {
        return this.#items.indexOf(item) !== -1;
    }

    get count() {
        return this.#items.length;
    }

    onCollectionChanged(callback: (args: CollectionChangedArgs) => void): void {
        this.#callbacks.add(callback);
    }

    removeCollectionChanged(callback: (args: CollectionChangedArgs) => void): void {
        this.#callbacks.delete(callback);
    }

    dispose() {
        this.#callbacks.clear();
        this.#items.length = 0;
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
