// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ICurve } from "chili-core";
import { SnapPointOnCurveData } from "../handlers";
import { ISnap, MouseAndDetected, SnapResult } from "../snap";

export class PointOnCurveSnap implements ISnap {
    constructor(readonly pointData: SnapPointOnCurveData) {}

    snap(data: MouseAndDetected): SnapResult | undefined {
        const ray = data.view.rayAt(data.mx, data.my);
        const curve = this.pointData.curve;
        const nearest = curve.nearestExtrema(ray);
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
