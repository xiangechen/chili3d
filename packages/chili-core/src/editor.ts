// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IView } from "./visual";

export interface IEditor {
    active(): boolean;
    deactive(): boolean;
    onPointerMove(view: IView, e: PointerEvent): void;
    onPointerDown(view: IView, e: PointerEvent): void;
    onPointerUp(view: IView, e: PointerEvent): void;
}
