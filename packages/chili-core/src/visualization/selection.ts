// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "../geometry";
import { ShapeType } from "../geometry/shapeType";
import { Model } from "../model";
import { IPropertyChanged } from "../observer";
import { IView } from "./view";
import { IVisualizationShape } from "./visualizationShape";

export interface ISelection extends IPropertyChanged {
    setSelectionType(type: ShapeType): void;
    select(view: IView, x: number, y: number, shiftDown: boolean): void;
    detectedShape(view: IView, x: number, y: number): IShape | undefined;
    detectedShapes(view: IView, x: number, y: number): IShape[];
    detectedModel(view: IView, x: number, y: number): IVisualizationShape | undefined;
    getSelectedModels(): Model[];
    setSelected(shift: boolean, ...models: Model[]): void;
    clearSelected(): void;
    unSelected(...models: Model[]): void;
}
