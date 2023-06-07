// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color } from "../base";
import { IShape, ShapeMeshData, ShapeType } from "../geometry";
import { IModel } from "../model";
import { IView } from "./view";
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

    // addShape(shape: IShape): void;
    // removeShape(shape: IShape): void;

    hilighted(shape: IShape): void;
    unHilighted(shape: IShape): void;

    temporaryDisplay(...datas: ShapeMeshData[]): number;
    temporaryRemove(id: number): void;
}
