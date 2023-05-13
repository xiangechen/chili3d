// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Flyout } from "chili-ui";

import { Plane, Ray, XY, XYZ } from "../math";
import { IPropertyChanged } from "../base";
import { CursorType } from "./cursorType";
import { IVisualShape } from "./visualShape";
import { IVisual } from "./visual";
import { IShape, ShapeType } from "../geometry";

export interface IView extends IPropertyChanged {
    readonly visual: IVisual;
    readonly float: Flyout;
    readonly container: HTMLElement;
    scale: number;
    workplane: Plane;
    detectedShapes(shapeType: ShapeType, x: number, y: number, firstHitOnly: boolean): IShape[];
    detectedVisualShapes(mx: number, my: number, firstHitOnly: boolean): IVisualShape[];
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
