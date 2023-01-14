// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { XYZ, Quaternion, IPropertyChanged, Result } from "chili-shared";
import { IBody } from "./body";
import { IEditor } from "./editor";
import { IShape } from "./shape";

export interface IModelObject extends IPropertyChanged {
    readonly id: string;
    readonly createdTime: number;
    parentId: string | undefined;
    name: string;
    location: XYZ;
    visible: boolean;
    rotate: Quaternion;
}

export interface IModel extends IModelObject {
    get body(): IBody;
    editors(): IEditor[];
    getEditor(index: number): IEditor | undefined;
    getShape(): Result<IShape>;
}

export interface IModelGroup extends IModelObject {
    children(): IModelObject[];
    addChild(model: IModelObject): void;
    removeChild(model: IModelObject): void;
}

export namespace IModelObject {
    export function isGroup(model: IModelObject): model is IModelGroup {
        return (model as IModelGroup).children !== undefined;
    }

    export function isModel(model: IModelObject): model is IModel {
        return (model as IModel).body !== undefined;
    }
}
