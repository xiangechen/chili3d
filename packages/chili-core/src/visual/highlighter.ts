// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ShapeType } from "../geometry";
import { IVisualShape, VisualState } from "./visualShape";

export interface IHighlighter {
    clear(): void;
    removeAllStates(shape: IVisualShape, resetState: boolean): void;
    updateStateData(
        shape: IVisualShape,
        mode: "add" | "remove",
        state: VisualState,
        type: ShapeType,
        index?: number,
    ): VisualState;
}
