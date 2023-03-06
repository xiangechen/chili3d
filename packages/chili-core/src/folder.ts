// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CollectionAction, CollectionPropertyObservable, Observable } from "./base";
import { Model } from "./model";

export interface IFolder {
    name: string;
    folder: IFolder | undefined;
}

export namespace IFolder {
    export function getDirectoryPath(current: IFolder): string {
        if (current.folder === undefined) return "/";
        let path = `/${current.folder.name}`;
        let folder = current.folder.folder;
        while (folder !== undefined) {
            path = `/${folder.name}/${path}`;
            folder = folder.folder;
        }
        return path;
    }
}

export class FlolderEntry extends CollectionPropertyObservable<IFolder> implements IFolder {
    private _name: string;
    private _children: IFolder[] = [];

    constructor(public folder: IFolder | undefined, name: string) {
        super();
        this._name = name;
    }

    get children(): ReadonlyArray<IFolder> {
        return this._children;
    }

    get name() {
        return this._name;
    }

    set name(value: string) {
        this.setProperty("name", value);
    }

    add(entry: IFolder) {
        if (!this._children.includes(entry)) {
            this._children.push(entry);
            this.emitCollectionChanged(CollectionAction.add, entry);
        }
    }

    remove(entry: IFolder) {
        let idx = this._children.indexOf(entry);
        if (idx > -1) {
            this._children.splice(idx, 1);
            this.emitCollectionChanged(CollectionAction.remove, entry);
        }
    }
}

export class ModelEntry extends Observable implements IFolder {
    private _visible: boolean;

    constructor(public folder: IFolder | undefined, readonly model: Model) {
        super();
        this._visible = model.parent === undefined;
        model.onPropertyChanged(this.onModelPropertyChanged);
    }

    get name() {
        return this.model.name;
    }

    set name(value: string) {
        this.model.name = value;
    }

    get visible() {
        return this._visible;
    }

    set visible(value: boolean) {
        this.setProperty("visible", value);
    }

    private onModelPropertyChanged = (source: Model, property: keyof Model, oldValue: any, newValue: any) => {
        if (property === "name") {
            this.emitPropertyChanged("name", oldValue, newValue);
        } else if (property === "parent") {
            this.visible = source.parent === undefined;
        }
    };
}
