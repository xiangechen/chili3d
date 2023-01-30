// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IShape, IView, ObjectSnapType, XYZ } from "chili-core";

export interface SnapedData {
    point: XYZ;
    info?: string;
    shapes: IShape[];
}

export interface DetectedData {
    view: IView;
    mx: number;
    my: number;
    shapes: IShape[];
}

export interface IKeyHandler {
    keyDown(view: IView, event: KeyboardEvent): void;
    keyUp(view: IView, event: KeyboardEvent): void;
}

export interface ISnap {
    snap(data: DetectedData): boolean;
    onSnapTypeChanged(snapType: ObjectSnapType): void;
    removeDynamicObject(): void;
    clear(): void;
}

export interface IPointSnap extends ISnap {
    point(): SnapedData | undefined;
}

export class ISnap {
    static isPointSnap(snap: ISnap): snap is IPointSnap {
        return (<IPointSnap>snap).point !== undefined;
    }
}

export interface IAngleSnap extends ISnap {
    angle(): number | undefined;
}

export interface LengthSnap extends ISnap {
    length(): number | undefined;
}
