// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { i18n, LineType, Plane, XYZ } from "chili-shared";
import { IView } from "../../view";
import { Axis } from "./axis";

export class AxisTrackingSnap {
    private axies: Map<IView, Axis[]> = new Map();

    constructor(readonly trackingZ: boolean) {}

    getAxies(view: IView, referencePoint: XYZ, angle: number | undefined = undefined) {
        if (!this.axies.has(view)) {
            this.axies.set(view, this.initAxes(view.workplane, referencePoint, angle));
        }
        return this.axies.get(view)!;
    }

    private initAxes(plane: Plane, referencePoint: XYZ, angle: number | undefined): Axis[] {
        if (angle === undefined) {
            return Axis.getAxiesAtPlane(referencePoint, plane, this.trackingZ);
        } else {
            let result: Axis[] = [];
            let testAngle = 0;
            while (testAngle < 360) {
                let direction = plane.x.rotate(plane.normal, (testAngle / 180) * Math.PI)!;
                result.push(new Axis(referencePoint, direction, `${testAngle} °`));
                testAngle += angle;
            }
            if (this.trackingZ) {
                result.push(new Axis(referencePoint, plane.normal, i18n["axis.z"]));
                result.push(new Axis(referencePoint, plane.normal.reverse(), i18n["axis.z"]));
            }
            return result;
        }
    }

    clear(): void {
        this.axies.clear();
    }
}
