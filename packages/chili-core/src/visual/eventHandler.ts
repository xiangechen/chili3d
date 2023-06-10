// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IView } from "./view";

export interface IEventHandler {
    pointerMove(view: IView, event: PointerEvent): void;
    pointerDown(view: IView, event: PointerEvent): void;
    pointerUp(view: IView, event: PointerEvent): void;
    pointerOut?(view: IView, event: PointerEvent): void;
    mouseWheel(view: IView, event: WheelEvent): void;
    keyDown(view: IView, event: KeyboardEvent): void;
    keyUp(view: IView, event: KeyboardEvent): void;
}
