// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ISnap, MouseAndDetected, SnapedData } from "../snap";
import { SnapPointOnCurveData } from "../snapEventHandler";

export class PointOnCurveSnap implements ISnap {
    constructor(readonly pointData: SnapPointOnCurveData) {}

    snap(data: MouseAndDetected): SnapedData | undefined {
        let ray = data.view.rayAt(data.mx, data.my);
        let nearest = this.pointData.curve.nearestExtrema(ray);
        if (nearest === undefined) return undefined;
        return {
            view: data.view,
            point: nearest.p1,
            shapes: [],
        };
    }

    removeDynamicObject(): void {}
    clear(): void {}
}
