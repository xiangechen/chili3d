// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IView, ObjectSnapType } from "chili-core";

import { IPointSnap, SnapInfo } from "./interfaces";

export class WorkplaneSnap implements IPointSnap {
    snaped?: SnapInfo;

    constructor() {}

    point(): SnapInfo | undefined {
        return this.snaped;
    }
    snap(view: IView, x: number, y: number): boolean {
        let ray = view.rayAt(x, y);
        let point = view.workplane.intersect(ray);
        if (point === undefined) return false;
        this.snaped = {
            point,
            shapes: [],
        };

        return true;
    }

    removeDynamicObject(): void {}

    onSnapTypeChanged(snapType: ObjectSnapType): void {}
    clear(): void {}
}
