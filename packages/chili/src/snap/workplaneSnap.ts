// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ObjectSnapType } from "chili-core";
import { DetectedData, IPointSnap, SnapedData } from "./interfaces";

export class WorkplaneSnap implements IPointSnap {
    onSnapTypeChanged(snapType: ObjectSnapType): void {}
    removeDynamicObject(): void {}
    clear(): void {}
    snaped?: SnapedData;

    point(): SnapedData | undefined {
        return this.snaped;
    }
    snap(data: DetectedData): boolean {
        let ray = data.view.rayAt(data.mx, data.my);
        let point = data.view.workplane.intersect(ray);
        if (point === undefined) return false;
        this.snaped = {
            point,
            shapes: [],
        };

        return true;
    }
}
