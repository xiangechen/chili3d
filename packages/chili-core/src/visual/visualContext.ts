// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color } from "../base";
import { RenderData } from "../geometry/renderData";
import { IShape } from "../geometry/shape";
import { IModel } from "../model";
import { IVisualShape } from "./visualShape";

export interface IVisualContext {
    get shapeCount(): number;
    hilightedColor: Color;
    selectedColor: Color;
    removeModel(models: IModel[]): void;
    shapes(): IVisualShape[];
    getShape(model: IModel): IVisualShape | undefined;
    getModel(shape: IVisualShape): IModel | undefined;

    hilighted(shape: IShape): void;
    unHilighted(shape: IShape): void;

    temporaryDisplay(...datas: RenderData[]): number;
    temporaryRemove(id: number): void;
}
