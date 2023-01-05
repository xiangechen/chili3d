// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "chili-geo";
import { XYZ, ObjectSnapType, I18n } from "chili-shared";
import { IView } from "chili-vis";

export interface SnapInfo {
    point: XYZ;
    info?: keyof I18n;
    shapes: IShape[];
}

export interface IKeyHandler {
    keyDown(view: IView, event: KeyboardEvent): void;
    keyUp(view: IView, event: KeyboardEvent): void;
}

export interface ISnap {
    snap(view: IView, x: number, y: number): boolean;
    onSnapTypeChanged(snapType: ObjectSnapType): void;
    removeDynamicObject(): void;
    clear(): void;
}

export interface IPointSnap extends ISnap {
    point(): SnapInfo | undefined;
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
