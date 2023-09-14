// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CollectionAction, CollectionChangedArgs, ObservableCollection } from "chili-core";
import { Props, div } from "../controls";

export interface ItemsProps extends Props {
    sources: ObservableCollection<any>;
    template: (item: any) => HTMLDivElement;
}

export const Items = (props: ItemsProps) => {
    const itemMap = new Map<any, HTMLDivElement>();
    let container = div({ ...props }, ...mapItems(props.sources.items, props.template, itemMap));
    const onCollectionChanged = collectionChangedFunction(container, props, itemMap);
    props.sources.onCollectionChanged(onCollectionChanged);
    return container;
};

function collectionChangedFunction(
    container: HTMLDivElement,
    props: ItemsProps,
    itemMap: Map<any, HTMLDivElement>,
) {
    return (args: CollectionChangedArgs) => {
        if (args.action === CollectionAction.add) {
            container.append(...mapItems(args.items, props.template, itemMap));
        } else if (args.action === CollectionAction.remove) {
            removeItem(container, args.items, itemMap);
        } else if (args.action === CollectionAction.move) {
            moveItem(container, args.from, args.to);
        } else if (args.action === CollectionAction.replace) {
            replaceItem(container, args.item, args.items, props.template, itemMap);
        } else {
            throw new Error("Unknown collection action");
        }
    };
}

function moveItem(container: HTMLDivElement, from: number, to: number) {
    let item1 = container.children.item(from);
    let item2 = container.children.item(to);
    if (item1 && item2) container.insertBefore(item1, item2);
}

function replaceItem(
    container: HTMLDivElement,
    item: any,
    items: any[],
    template: (item: any) => HTMLDivElement,
    itemMap: Map<any, HTMLDivElement>,
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

function mapItems(items: any[], template: (item: any) => HTMLDivElement, itemMap: Map<any, HTMLDivElement>) {
    return items.map((item) => {
        if (itemMap.has(item)) return itemMap.get(item)!;
        let e = template(item);
        itemMap.set(item, e);
        return e;
    });
}

function removeItem(container: HTMLDivElement, items: any[], itemMap: Map<any, HTMLDivElement>) {
    items.forEach((item) => {
        if (itemMap.has(item)) {
            container.removeChild(itemMap.get(item)!);
            itemMap.delete(item);
        }
    });
}
