// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Plane, Ray, XY, XYZ } from "../math";
import { IPropertyChanged } from "../base";
import { CursorType } from "./cursorType";
import { IViewer } from "./viewer";
import { IShape, ShapeType } from "../geometry";
import { IVisualShape } from "./visualShape";
import { DetectedData } from "./detectedData";

export interface IView extends IPropertyChanged {
    readonly viewer: IViewer;
    readonly container: HTMLElement;
    scale: number;
    workplane: Plane;
    redraw(): void;
    up(): XYZ;
    direction(): XYZ;
    lookAt(cameraLocation: XYZ, target: XYZ): void;
    rayAt(mx: number, my: number): Ray;
    screenToWorld(mx: number, my: number): XYZ;
    worldToScreen(point: XYZ): XY;
    resize(width: number, heigth: number): void;
    setCursor(cursor: CursorType): void;
    pan(dx: number, dy: number): void;
    rotation(dx: number, dy: number): void;
    startRotation(dx: number, dy: number): void;
    zoom(x: number, y: number, delta: number): void;
    detected(shapeType: ShapeType, x: number, y: number, firstHitOnly: boolean): DetectedData[];
    detectedVisualShapes(mx: number, my: number, firstHitOnly: boolean): IVisualShape[];
}
