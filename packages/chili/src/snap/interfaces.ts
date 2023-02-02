// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape, IView, ObjectSnapType, XYZ } from "chili-core";

export interface SnapedData {
    view: IView;
    point: XYZ;
    info?: string;
    shapes: IShape[];
}

export interface SnapedLengthData extends SnapedData {
    length: number;
}

export interface MouseAndDetected {
    view: IView;
    mx: number;
    my: number;
    shapes: IShape[];
}

export interface SnapChangedHandler {
    onSnapChanged(view: IView, snaped: SnapedData | undefined): void;
}

export interface ISnap {
    snap(data: MouseAndDetected): SnapedData | undefined;
    onSnapTypeChanged(snapType: ObjectSnapType): void;
    removeDynamicObject(): void;
    clear(): void;
}

export interface IAngleSnap extends ISnap {
    angle(): number | undefined;
}

export interface LengthSnap extends ISnap {
    length(): number | undefined;
}
