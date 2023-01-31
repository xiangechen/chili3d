// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ObjectSnapType } from "chili-core";
import { MouseAndDetected, ISnap, SnapedData } from "./interfaces";

export class WorkplaneSnap implements ISnap {
    onSnapTypeChanged(snapType: ObjectSnapType): void {}
    removeDynamicObject(): void {}
    clear(): void {}
    snap(data: MouseAndDetected): SnapedData | undefined {
        let ray = data.view.rayAt(data.mx, data.my);
        let point = data.view.workplane.intersect(ray);
        if (point === undefined) return undefined;
        return {
            point,
            shapes: [],
        };
    }
}
