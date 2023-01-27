// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { FloatContainer } from "chili-ui";
import { IDocument } from "../document";
import { Plane, Ray, XY, XYZ } from "../math";
import { IPropertyChanged } from "../observer";
import { CursorType } from "./cursorType";

export interface IView extends IPropertyChanged {
    get document(): IDocument;
    get float(): FloatContainer;
    get container(): HTMLElement;
    get scale(): number;
    workplane: Plane;
    update(): void;
    redraw(): void;
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
