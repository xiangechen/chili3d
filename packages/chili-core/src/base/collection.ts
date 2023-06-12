// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export type CollectionChangedHandler<T> = (
    source: ICollection<T>,
    action: CollectionAction,
    item: T
) => void;

export enum CollectionAction {
    add,
    remove,
    replace,
    insert,
}

export interface ICollectionChanged<T> {
    onCollectionChanged<T>(handler: CollectionChangedHandler<T>): void;
    removeCollectionChanged<T>(handler: CollectionChangedHandler<T>): void;
}

export interface ICollection<T> {
    add(...items: T[]): void;
    remove(...items: T[]): void;
    size(): number;
}

export interface IList<T> extends ICollection<T> {
    insert(index: number, item: T): void;
    replace(index: number, items: T): void;
    [index: number]: T;
    at(index: number): T | undefined;
}
