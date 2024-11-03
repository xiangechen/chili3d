// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ShapeMeshData, ShapeType } from "../shape";
import { IVisualObject } from "./visualObject";
import { VisualState } from "./visualShape";

export interface IHighlighter {
    getState(shape: IVisualObject, type: ShapeType, index?: number): VisualState | undefined;
    clear(): void;
    resetState(shape: IVisualObject): void;
    addState(shape: IVisualObject, state: VisualState, type: ShapeType, ...index: number[]): void;
    removeState(shape: IVisualObject, state: VisualState, type: ShapeType, ...index: number[]): void;
    highlightMesh(...datas: ShapeMeshData[]): number;
    removeHighlightMesh(id: number): void;
}
