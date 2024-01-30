// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CollectionAction, CollectionChangedArgs, ObservableCollection } from "chili-core";
import { HTMLConfig, setProperties } from "../controls";

export type ItemsConfig<T> = HTMLConfig<ItemsElement<T>> & {
    sources: ObservableCollection<T> | Array<T>;
    template: (item: T) => HTMLElement | SVGSVGElement;
};

export class ItemsElement<T> extends HTMLElement {
    private _itemMap = new Map<T, HTMLElement | SVGSVGElement>();
    constructor(readonly props: ItemsConfig<T>) {
        super();
        setProperties(this, props as any);
        const items = Array.isArray(props.sources) ? props.sources : props.sources.items;
        this.append(...this._mapItems(items));
    }

    getItem(item: any): HTMLElement | SVGSVGElement | undefined {
        return this._itemMap.get(item);
    }

    connectedCallback() {
        if (this.props.sources instanceof ObservableCollection)
            this.props.sources.onCollectionChanged(this._onCollectionChanged);
    }

    disconnectedCallback() {
        if (this.props.sources instanceof ObservableCollection)
            this.props.sources.removeCollectionChanged(this._onCollectionChanged);
    }

    private _onCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === CollectionAction.add) {
            this.append(...this._mapItems(args.items));
        } else if (args.action === CollectionAction.remove) {
            this._removeItem(args.items);
        } else if (args.action === CollectionAction.move) {
            this._moveItem(args.from, args.to);
        } else if (args.action === CollectionAction.replace) {
            this._replaceItem(args.item, args.items);
        } else {
            throw new Error("Unknown collection action");
        }
    };

    private _moveItem(from: number, to: number) {
        let item1 = this.children.item(from);
        let item2 = this.children.item(to);
        if (item1 && item2) this.insertBefore(item1, item2);
    }

    private _replaceItem(item: any, items: any[]) {
        let child = this._itemMap.get(item);
        if (child) {
            items.forEach((item) => {
                let e = this.props.template(item);
                this._itemMap.set(item, e);
                this.insertBefore(e, child!);
            });
            this._removeItem([item]);
        }
    }

    private _mapItems(items: any[]) {
        return items.map((item) => {
            if (this._itemMap.has(item)) return this._itemMap.get(item)!;
            let e = this.props.template(item);
            this._itemMap.set(item, e);
            return e;
        });
    }

    private _removeItem(items: any[]) {
        items.forEach((item) => {
            if (this._itemMap.has(item)) {
                this.removeChild(this._itemMap.get(item)!);
                this._itemMap.delete(item);
            }
        });
    }
}

customElements.define("chili-items", ItemsElement);
