// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IView } from "./view";

export interface IEventHandler {
    mouseMove(view: IView, event: MouseEvent): void;
    mouseDown(view: IView, event: MouseEvent): void;
    mouseUp(view: IView, event: MouseEvent): void;
    mouseOut(view: IView, event: MouseEvent): void;
    mouseWheel(view: IView, event: WheelEvent): void;
    keyDown(view: IView, event: KeyboardEvent): void;
    keyUp(view: IView, event: KeyboardEvent): void;
    touchStart(view: IView, event: TouchEvent): void;
    touchMove(view: IView, event: TouchEvent): void;
    touchEnd(view: IView, event: TouchEvent): void;
}
