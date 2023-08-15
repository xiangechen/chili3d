// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CollectionAction, CollectionChangedArgs, ObservableCollection } from "chili-core";
import { Options, ul } from "../controls";

export interface ItemsOption extends Options {
    sources: ObservableCollection<any>;
    template: (item: any) => HTMLLIElement;
}

export const Items = (option: ItemsOption) => {
    const itemMap = new Map<any, HTMLLIElement>();
    let container = ul({ ...option }, ...mapItems(option.sources.items, option.template, itemMap));
    const onCollectionChanged = collectionChangedFunction(container, option, itemMap);
    option.sources.onCollectionChanged(onCollectionChanged);
    return container;
};

function collectionChangedFunction(
    container: HTMLUListElement,
    option: ItemsOption,
    itemMap: Map<any, HTMLLIElement>
) {
    return (args: CollectionChangedArgs) => {
        if (args.action === CollectionAction.add) {
            container.append(...mapItems(args.items, option.template, itemMap));
        } else if (args.action === CollectionAction.remove) {
            removeItem(container, args.items, itemMap);
        } else if (args.action === CollectionAction.move) {
            moveItem(container, args.from, args.to);
        } else if (args.action === CollectionAction.replace) {
            replaceItem(container, args.item, args.items, option.template, itemMap);
        } else {
            throw new Error("Unknown collection action");
        }
    };
}

function moveItem(container: HTMLUListElement, from: number, to: number) {
    let item1 = container.children.item(from);
    let item2 = container.children.item(to);
    if (item1 && item2) container.insertBefore(item1, item2);
}

function replaceItem(
    container: HTMLUListElement,
    item: any,
    items: any[],
    template: (item: any) => HTMLLIElement,
    itemMap: Map<any, HTMLLIElement>
) {
    let child = itemMap.get(item);
    if (child) {
        items.forEach((item) => {
            let e = template(item);
            itemMap.set(item, e);
            container.insertBefore(e, child!);
        });
        removeItem(container, [item], itemMap);
    }
}

function mapItems(items: any[], template: (item: any) => HTMLLIElement, itemMap: Map<any, HTMLLIElement>) {
    return items.map((item) => {
        if (itemMap.has(item)) return itemMap.get(item)!;
        let e = template(item);
        itemMap.set(item, e);
        return e;
    });
}

function removeItem(container: HTMLUListElement, items: any[], itemMap: Map<any, HTMLLIElement>) {
    items.forEach((item) => {
        if (itemMap.has(item)) {
            container.removeChild(itemMap.get(item)!);
            itemMap.delete(item);
        }
    });
}
