// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color } from "../base";
import { RenderData, IShape, ShapeType } from "../geometry";
import { IModel } from "../model";
import { IView } from "./view";
import { IVisualShape } from "./visualShape";

export interface IVisualContext {
    get shapeCount(): number;
    hilightedColor: Color;
    selectedColor: Color;
    addModel(models: IModel[]): void;
    removeModel(models: IModel[]): void;
    getShape(model: IModel): IVisualShape | undefined;
    getModel(shape: IVisualShape): IModel | undefined;
    redrawModel(models: IModel[]): void;
    setVisible(model: IModel, visible: boolean): void;

    detectedShapes(shapeType: ShapeType, view: IView, x: number, y: number, firstHitOnly: boolean): IShape[];
    detectedVisualShapes(view: IView, mx: number, my: number, firstHitOnly: boolean): IVisualShape[];

    shapes(): IVisualShape[];

    // addShape(shape: IShape): void;
    // removeShape(shape: IShape): void;

    hilighted(shape: IShape): void;
    unHilighted(shape: IShape): void;

    temporaryDisplay(...datas: RenderData[]): number;
    temporaryRemove(id: number): void;
}
