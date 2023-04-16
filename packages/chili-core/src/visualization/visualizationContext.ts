// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { RenderData } from "../geometry/renderData";
import { IShape } from "../geometry/shape";
import { IModel } from "../model";
import { IVisualizationShape } from "./visualizationShape";

export interface IVisualizationContext {
    get shapeCount(): number;
    removeModel(models: IModel[]): void;
    getShape(model: IModel): IVisualizationShape | undefined;

    hilighted(shape: IShape): void;
    unHilighted(shape: IShape): void;

    temporaryDisplay(...datas: RenderData[]): number;
    temporaryRemove(id: number): void;
}
