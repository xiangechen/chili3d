// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDisposable } from "../base";
import { Plane } from "../math";
import { CursorType } from "./cursorType";
import { IView } from "./view";
import { IVisual } from "./visual";

export interface IViewer extends IDisposable {
    readonly visual: IVisual;
    activeView: IView | undefined;
    createView(name: string, workplane: Plane, dom: HTMLElement): IView;
    removeView(view: IView): void;
    views(): readonly IView[];
    redraw(): void;
    setCursor(cursor: CursorType): void;
}
