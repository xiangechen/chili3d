// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IPropertyChanged } from "../base";
import { ShapeType } from "../geometry";
import { Plane, Ray, XY, XYZ } from "../math";
import { CursorType } from "./cursorType";
import { VisualShapeData } from "./detectedData";
import { IViewer } from "./viewer";

export interface IView extends IPropertyChanged {
    readonly viewer: IViewer;
    readonly container: HTMLElement;
    name: string;
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
    zoom(x: number, y: number, delta: number): void;
    detected(shapeType: ShapeType, x: number, y: number, firstHitOnly: boolean): VisualShapeData[];
    rectDetected(shapeType: ShapeType, x1: number, y1: number, x2: number, y2: number): VisualShapeData[];
}
