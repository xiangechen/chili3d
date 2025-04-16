// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
        switch (args.action) {
            case CollectionAction.add:
                this.append(...this._mapItems(args.items));
                break;
            case CollectionAction.remove:
                this._removeItem(args.items);
                break;
            case CollectionAction.move:
                this._moveItem(args.from, args.to);
                break;
            case CollectionAction.replace:
                this._replaceItem(args.index, args.item, args.items);
                break;
            default:
                throw new Error("Unknown collection action");
        }
    };

    private _moveItem(from: number, to: number) {
        const item1 = this.children.item(from);
        const item2 = this.children.item(to);
        if (item1 && item2) this.insertBefore(item1, item2);
    }

    private _replaceItem(index: number, item: T, items: T[]) {
        const child = this._itemMap.get(item);
        if (child) {
            items.forEach((item, i) => {
                const e = this.props.template(item, index + i);
                this._itemMap.set(item, e);
                this.insertBefore(e, child);
            });
            this._removeItem([item]);
        }
    }

    private _mapItems(items: T[]) {
        const index = this._itemMap.size;
        return items.map((item, i) => {
            if (this._itemMap.has(item)) return this._itemMap.get(item)!;
            const e = this.props.template(item, index + i);
            this._itemMap.set(item, e);
            return e;
        });
    }

    private _removeItem(items: T[]) {
        items.forEach((item) => {
            const child = this._itemMap.get(item);
            if (child) {
                child.remove();
                this._itemMap.delete(item);
            }
        });
    }
}

customElements.define("chili-collection", Collection);
