// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type CollectionChangedArgs, ObservableCollection } from "@chili3d/core";
import type { HTMLProps } from "./htmlProps";
import { setProperties } from "./utils";

export type CollectionProps<T> = HTMLProps<Collection<T>> & {
    sources: ObservableCollection<T> | Array<T>;
    /** Returning `undefined` leaves the item out of the DOM. */
    template: (item: T, index: number) => HTMLElement | SVGSVGElement | undefined;
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
        const items = Array.isArray(this.props.sources) ? this.props.sources : this.props.sources.items();
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
            case "add":
                this.append(...this._mapItems(args.items));
                break;
            case "remove":
                this._removeItem(args.items);
                break;
            case "move":
                this._moveItem();
                break;
            case "replace":
                this._replaceItem(args.index, args.item, args.items);
                break;
            default:
                throw new Error("Unknown collection action");
        }
    };

    private _moveItem() {
        // Source indices are not child indices: items whose template returned undefined have no
        // element, so re-appending in source order is what keeps the DOM in step.
        const sources = this.props.sources;
        const items = Array.isArray(sources) ? sources : sources.items();
        for (const item of items) {
            const el = this._itemMap.get(item);
            if (el) this.append(el);
        }
    }

    private _replaceItem(index: number, item: T, items: T[]) {
        const child = this._itemMap.get(item);
        if (child) {
            items.forEach((item, i) => {
                const e = this.props.template(item, index + i);
                if (!e) return;
                this._itemMap.set(item, e);
                this.insertBefore(e, child);
            });
            this._removeItem([item]);
        }
    }

    private _mapItems(items: T[]) {
        const index = this._itemMap.size;
        const elements: (HTMLElement | SVGSVGElement)[] = [];
        items.forEach((item, i) => {
            const existing = this._itemMap.get(item);
            if (existing) {
                elements.push(existing);
                return;
            }
            const e = this.props.template(item, index + i);
            if (!e) return;
            this._itemMap.set(item, e);
            elements.push(e);
        });
        return elements;
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
