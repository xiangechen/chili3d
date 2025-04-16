// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
