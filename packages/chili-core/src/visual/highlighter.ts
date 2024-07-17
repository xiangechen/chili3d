// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ShapeMeshData, ShapeType } from "../shape";
import { IVisualGeometry, VisualState } from "./visualShape";

export interface IHighlighter {
    getState(shape: IVisualGeometry, type: ShapeType, index?: number): VisualState | undefined;
    clear(): void;
    resetState(shape: IVisualGeometry): void;
    addState(shape: IVisualGeometry, state: VisualState, type: ShapeType, ...index: number[]): void;
    removeState(shape: IVisualGeometry, state: VisualState, type: ShapeType, ...index: number[]): void;
    highliteMesh(...datas: ShapeMeshData[]): number;
    removeMesh(id: number): void;
}
