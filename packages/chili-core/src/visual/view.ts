// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable, IPropertyChanged } from "../base";
import { ShapeType } from "../geometry";
import { Plane, Ray, XY, XYZ } from "../math";
import { IShapeFilter } from "../selectionFilter";
import { CursorType } from "./cursorType";
import { VisualShapeData } from "./detectedData";
import { IViewer } from "./viewer";

export interface IView extends IPropertyChanged, IDisposable {
    readonly viewer: IViewer;
    readonly container: HTMLElement;
    name: string;
    scale: number;
    workplane: Plane;
    redraw(): void;
    up(): XYZ;
    toImage(): string;
    direction(): XYZ;
    lookAt(cameraLocation: XYZ, target: XYZ): void;
    rayAt(mx: number, my: number): Ray;
    screenToWorld(mx: number, my: number): XYZ;
    worldToScreen(point: XYZ): XY;
    resize(width: number, heigth: number): void;
    setCursor(cursor: CursorType): void;
    pan(dx: number, dy: number): void;
    rotation(dx: number, dy: number): void;
    fitContent(): void;
    zoom(x: number, y: number, delta: number): void;
    detected(shapeType: ShapeType, x: number, y: number, shapeFilter?: IShapeFilter): VisualShapeData[];
    rectDetected(
        shapeType: ShapeType,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        shapeFilter?: IShapeFilter,
    ): VisualShapeData[];
}

export namespace IView {
    export function screenDistance(view: IView, mx: number, my: number, point: XYZ) {
        let xy = view.worldToScreen(point);
        let dx = xy.x - mx;
        let dy = xy.y - my;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
