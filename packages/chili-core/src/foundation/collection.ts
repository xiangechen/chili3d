// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
          index: number;
          item: any;
          items: any[];
      };

export interface ICollectionChanged {
    onCollectionChanged(callback: (args: CollectionChangedArgs) => void): void;
    removeCollectionChanged(callback: (args: CollectionChangedArgs) => void): void;
}

export class ObservableCollection<T> implements ICollectionChanged, IDisposable {
    private readonly _callbacks = new Set<(args: CollectionChangedArgs) => void>();
    private _items: T[];

    constructor(...items: T[]) {
        this._items = [...items];
    }

    push(...items: T[]) {
        if (items.length === 0) return;
        this._items.push(...items);
        this.notifyChange({
            action: CollectionAction.add,
            items,
        });
    }

    remove(...items: T[]) {
        if (items.length === 0) return;
        const itemSet = new Set(items);
        this._items = this._items.filter((item) => !itemSet.has(item));
        this.notifyChange({
            action: CollectionAction.remove,
            items,
        });
    }

    move(from: number, to: number) {
        if (!this.isValidMove(from, to)) return;

        const items = this._items.splice(from, 1);
        this._items.splice(from < to ? to - 1 : to, 0, ...items);
        this.notifyChange({
            action: CollectionAction.move,
            from,
            to,
        });
    }

    private isValidMove(from: number, to: number): boolean {
        return from !== to && from >= 0 && from < this._items.length && to >= 0 && to < this._items.length;
    }

    clear() {
        if (this._items.length === 0) return;
        const items = [...this._items];
        this._items = [];
        this.notifyChange({
            action: CollectionAction.remove,
            items,
        });
    }

    get length() {
        return this._items.length;
    }

    replace(index: number, ...items: T[]) {
        if (!this.isValidIndex(index)) return;

        const item = this._items[index];
        this._items.splice(index, 1, ...items);
        this.notifyChange({
            action: CollectionAction.replace,
            index,
            item,
            items,
        });
    }

    private isValidIndex(index: number): boolean {
        return index >= 0 && index < this._items.length;
    }

    private notifyChange(args: CollectionChangedArgs) {
        this._callbacks.forEach((callback) => callback(args));
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

    indexOf(item: T, fromIndex?: number) {
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
