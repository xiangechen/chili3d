// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CollectionAction, CollectionChangedArgs, ObservableCollection } from "chili-core";
import { setProperties } from "./controls";
import { HTMLProps } from "./htmlProps";

export type CollectionProps<T> = HTMLProps<Collection<T>> & {
    sources: ObservableCollection<T> | Array<T>;
    template: (item: T, index: number) => HTMLElement | SVGSVGElement;
};

export class Collection<T> extends HTMLElement {
    private readonly _itemMap = new Map<T, HTMLElement | SVGSVGElement>();
    constructor(readonly props: CollectionProps<T>) {
        super();
        setProperties(this, props as any);
    }

    getItem(item: T): HTMLElement | SVGSVGElement | undefined {
        return this._itemMap.get(item);
    }

    connectedCallback() {
        const items = Array.isArray(this.props.sources) ? this.props.sources : this.props.sources.items;
        this.append(...this._mapItems(items));
        if (this.props.sources instanceof ObservableCollection)
            this.props.sources.onCollectionChanged(this._onCollectionChanged);
    }

    disconnectedCallback() {
        this._itemMap.forEach((x) => x.remove());
        this._itemMap.clear();
        if (this.props.sources instanceof ObservableCollection)
            this.props.sources.removeCollectionChanged(this._onCollectionChanged);
    }

    private readonly _onCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === CollectionAction.add) {
            this.append(...this._mapItems(args.items));
        } else if (args.action === CollectionAction.remove) {
            this._removeItem(args.items);
        } else if (args.action === CollectionAction.move) {
            this._moveItem(args.from, args.to);
        } else if (args.action === CollectionAction.replace) {
            this._replaceItem(args.index, args.item, args.items);
        } else {
            throw new Error("Unknown collection action");
        }
    };

    private _moveItem(from: number, to: number) {
        let item1 = this.children.item(from);
        let item2 = this.children.item(to);
        if (item1 && item2) this.insertBefore(item1, item2);
    }

    private _replaceItem(index: number, item: T, items: T[]) {
        let child = this._itemMap.get(item);
        if (child) {
            items.forEach((item, i) => {
                let e = this.props.template(item, index + i);
                this._itemMap.set(item, e);
                this.insertBefore(e, child);
            });
            this._removeItem([item]);
        }
    }

    private _mapItems(items: T[]) {
        let index = this._itemMap.size;
        return items.map((item, i) => {
            if (this._itemMap.has(item)) return this._itemMap.get(item)!;
            let e = this.props.template(item, index + i);
            this._itemMap.set(item, e);
            return e;
        });
    }

    private _removeItem(items: T[]) {
        items.forEach((item) => {
            if (this._itemMap.has(item)) {
                this._itemMap.get(item)?.remove();
                this._itemMap.delete(item);
            }
        });
    }
}

customElements.define("chili-collection", Collection);
