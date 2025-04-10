// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { SnapPointOnCurveData } from "../handlers";
import { ISnap, MouseAndDetected, SnapResult } from "../snap";

export class PointOnCurveSnap implements ISnap {
    constructor(readonly pointData: SnapPointOnCurveData) {}

    snap(data: MouseAndDetected): SnapResult | undefined {
        const ray = data.view.rayAt(data.mx, data.my);
        const nearest = this.pointData.curve.nearestExtrema(ray);
        if (!nearest) return undefined;
        return {
            view: data.view,
            point: nearest.p1,
            shapes: [],
        };
    }

    removeDynamicObject(): void {}
    clear(): void {}
}
