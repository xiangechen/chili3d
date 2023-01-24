// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ModelObject, IShape } from "chili-core";
import { IPropertyChanged, ShapeType } from "chili-shared";
import { IView } from "./view";
import { IVisualizationShape } from "./visualizationShape";

export interface ISelection extends IPropertyChanged {
    setSelectionType(type: ShapeType): void;
    select(view: IView, x: number, y: number, shiftDown: boolean): void;
    detectedShape(view: IView, x: number, y: number): IShape | undefined;
    detectedShapes(view: IView, x: number, y: number): IShape[];
    detectedModel(view: IView, x: number, y: number): IVisualizationShape | undefined;
    getSelectedModels(): ModelObject[];
    setSelected(shift: boolean, ...models: ModelObject[]): void;
    clearSelected(): void;
    unSelected(...models: ModelObject[]): void;
}
