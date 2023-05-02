// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape, ShapeType } from "../geometry";
import { IModel } from "../model";
import { IVisualizationShape } from "./visualizationShape";

export interface ISelection {
    select(x: number, y: number, toggleSelected: boolean): void;
    detectedShapes(x: number, y: number): IShape[];
    detectedModel(x: number, y: number): IVisualizationShape | undefined;
}
