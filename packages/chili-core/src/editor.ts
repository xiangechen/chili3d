// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IView } from "./visual";

export interface IEditor {
    active(): boolean;
    deactive(): boolean;
    onPointerMove(view: IView, e: PointerEvent): void;
    onPointerDown(view: IView, e: PointerEvent): void;
    onPointerUp(view: IView, e: PointerEvent): void;
}
