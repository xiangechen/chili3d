// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "chili-core";
import { IDisposable, XYZ, Quaternion, IPropertyChanged } from "chili-shared";
import { IBody } from "./body";
import { IEditor, IEditedResult } from "./editor";
import { IShape } from "./shape";

export interface IModelObject extends IPropertyChanged {
    readonly document: IDocument;
    readonly id: string;
    readonly createdTime: number;
    parentId: string | undefined;
    getParent(): IModelObject | undefined;
    get name(): string;
    set name(value: string);
    get position(): XYZ;
    set position(value: XYZ);
    get visible(): boolean;
    set visible(value: boolean);
    get rotate(): Quaternion;
    set rotate(value: Quaternion);
}

export interface ModelEventMap {
    addEditor: IEditor;
}

export interface IModel extends IModelObject {
    get body(): IBody;
    get status(): IEditedResult;
    editors(): IEditor[];
    getEditor(index: number): IEditor | undefined;
    getShape(): IShape | undefined;
}

export interface IModelGroup extends IModelObject {
    children(): IModelObject[];
}

export namespace IModelObject {
    export function isGroup(model: IModelObject): model is IModelGroup {
        return (model as IModelGroup).children !== undefined;
    }

    export function isModel(model: IModelObject): model is IModel {
        return (model as IModel).body !== undefined;
    }
}
