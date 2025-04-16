// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, IView, Plane, XYZ } from "chili-core";
import { Axis } from "./axis";
import { TrackingBase } from "./trackingBase";

export class AxisTracking extends TrackingBase {
    private readonly axies: Map<IView, Axis[]> = new Map();

    constructor(trackingZ: boolean) {
        super(trackingZ);
    }

    getAxes(view: IView, referencePoint: XYZ, angle: number | undefined = undefined) {
        if (!this.axies.has(view)) {
            this.axies.set(view, this.initAxes(view.workplane, referencePoint, angle));
        }
        return this.axies.get(view)!;
    }

    private initAxes(plane: Plane, referencePoint: XYZ, angle: number | undefined): Axis[] {
        if (angle === undefined) {
            return Axis.getAxiesAtPlane(referencePoint, plane, this.trackingZ);
        }

        const result: Axis[] = [];
        let testAngle = 0;
        while (testAngle < 360) {
            let direction = plane.xvec.rotate(plane.normal, (testAngle / 180) * Math.PI)!;
            result.push(new Axis(referencePoint, direction, `${testAngle} °`));
            testAngle += angle;
        }
        if (this.trackingZ) {
            result.push(new Axis(referencePoint, plane.normal, I18n.translate("axis.z")));
            result.push(new Axis(referencePoint, plane.normal.reverse(), I18n.translate("axis.z")));
        }

        return result;
    }

    override clear(): void {
        super.clear();
        this.axies.clear();
    }
}
