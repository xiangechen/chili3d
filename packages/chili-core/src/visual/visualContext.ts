// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable, INodeChangedObserver } from "../foundation";
import { XYZ } from "../math";
import { IModel } from "../model";
import { IShapeFilter } from "../selectionFilter";
import { ShapeMeshData } from "../shape";
import { IVisualObject } from "./visualObject";
import { IVisualGeometry } from "./visualShape";

export interface IVisualContext extends IDisposable, INodeChangedObserver {
    get shapeCount(): number;
    addVisualObject(object: IVisualObject): void;
    boundingBoxIntersectFilter(
        boundingBox: {
            min: XYZ;
            max: XYZ;
        },
        filter?: IShapeFilter,
    ): IVisualGeometry[];
    removeVisualObject(object: IVisualObject): void;
    addModel(models: IModel[]): void;
    removeModel(models: IModel[]): void;
    getShape(model: IModel): IVisualGeometry | undefined;
    getModel(shape: IVisualGeometry): IModel | undefined;
    redrawModel(models: IModel[]): void;
    setVisible(model: IModel, visible: boolean): void;
    shapes(): IVisualGeometry[];
    displayMesh(...datas: ShapeMeshData[]): number;
    removeMesh(id: number): void;
}
