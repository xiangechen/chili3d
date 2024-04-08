// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ShapeType } from "../shape";
import { IVisualGeometry, VisualState } from "./visualShape";

export interface IHighlighter {
    clear(): void;
    removeAllStates(shape: IVisualGeometry, resetState: boolean): void;
    updateStateData(
        shape: IVisualGeometry,
        mode: "add" | "remove",
        state: VisualState,
        type: ShapeType,
        index?: number,
    ): VisualState;
}
