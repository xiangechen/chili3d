// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { IDisposable, IPropertyChanged } from "../foundation";
import { Plane, Ray, XY, XYZ } from "../math";
import { INodeFilter, IShapeFilter } from "../selectionFilter";
import { ShapeType } from "../shape";
import { VisualShapeData } from "./detectedData";
import { IVisualObject } from "./visualObject";

export enum CameraType {
    perspective,
    orthographic,
}

export interface IView extends IPropertyChanged, IDisposable {
    readonly document: IDocument;
    get isClosed(): boolean;
    name: string;
    workplane: Plane;
    cameraType: CameraType;
    cameraTarget: XYZ;
    cameraPosition: XYZ;
    onKeyDown(e: KeyboardEvent): void;
    onKeyUp(e: KeyboardEvent): void;
    update(): void;
    up(): XYZ;
    toImage(): string;
    direction(): XYZ;
    rotate(dx: number, dy: number): Promise<void>;
    zoomIn(): Promise<void>;
    zoomOut(): Promise<void>;
    rayAt(mx: number, my: number): Ray;
    screenToWorld(mx: number, my: number): XYZ;
    worldToScreen(point: XYZ): XY;
    fitContent(): Promise<void>;
    resize(width: number, heigth: number): void;
    setDom(element: HTMLElement): void;
    close(): void;
    detectVisual(x: number, y: number, nodeFilter?: INodeFilter): IVisualObject[];
    detectVisualRect(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        nodeFilter?: INodeFilter,
    ): IVisualObject[];
    detectShapes(shapeType: ShapeType, x: number, y: number, shapeFilter?: IShapeFilter): VisualShapeData[];
    detectShapesRect(
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
