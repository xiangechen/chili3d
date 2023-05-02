// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Flyout } from "chili-ui";

import { Plane, Ray, XY, XYZ } from "../math";
import { IPropertyChanged } from "../base";
import { CursorType } from "./cursorType";
import { IViewer } from "./viewer";
import { ISelection } from "./selection";

export interface IView extends IPropertyChanged {
    get viewer(): IViewer;
    get float(): Flyout;
    get container(): HTMLElement;
    get scale(): number;
    get selection(): ISelection;
    workplane: Plane;
    update(): void;
    redraw(): void;
    up(): XYZ;
    direction(): XYZ;
    rayAt(mx: number, my: number): Ray;
    screenToWorld(mx: number, my: number): XYZ;
    worldToScreen(point: XYZ): XY;
    resize(width: number, heigth: number): void;
    setCursor(cursor: CursorType): void;
    pan(dx: number, dy: number): void;
    rotation(dx: number, dy: number): void;
    startRotation(dx: number, dy: number): void;
    zoom(x: number, y: number, delta: number): void;
}
