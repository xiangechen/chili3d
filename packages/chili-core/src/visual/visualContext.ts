// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ShapeMeshData } from "../geometry";
import { IModel } from "../model";
import { IVisualShape } from "./visualShape";

export interface IVisualContext {
    get shapeCount(): number;
    addModel(models: IModel[]): void;
    removeModel(models: IModel[]): void;
    getShape(model: IModel): IVisualShape | undefined;
    getModel(shape: IVisualShape): IModel | undefined;
    redrawModel(models: IModel[]): void;
    setVisible(model: IModel, visible: boolean): void;
    shapes(): IVisualShape[];
    displayShapeMesh(...datas: ShapeMeshData[]): number;
    removeShapeMesh(id: number): void;
}
