// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable, INodeChangedObserver } from "../foundation";
import { XYZ } from "../math";
import { INode } from "../model";
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
    addModel(models: INode[]): void;
    removeModel(models: INode[]): void;
    getShape(model: INode): IVisualGeometry | undefined;
    getModel(shape: IVisualGeometry): INode | undefined;
    redrawModel(models: INode[]): void;
    setVisible(model: INode, visible: boolean): void;
    shapes(): IVisualGeometry[];
    displayMesh(...datas: ShapeMeshData[]): number;
    removeMesh(id: number): void;
}
