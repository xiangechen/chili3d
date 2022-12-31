// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { LineType, Plane, XYZ } from "chili-shared";
import { IView } from "chili-vis";
import { IPointSnap, ISnap, SnapInfo } from "chili-ui";
import { ObjectSnapType } from "chili-ui";
import { Axis } from "./axis";

export class AxisTrackingSnap {
    private axies: Map<IView, Axis[]> = new Map();

    constructor() {}

    getAxies(view: IView, referencePoint: XYZ, angle: number | undefined = undefined) {
        if (!this.axies.has(view)) {
            this.axies.set(view, this.initAxes(view.workplane, referencePoint, angle));
        }
        return this.axies.get(view)!;
    }

    private initAxes(plane: Plane, referencePoint: XYZ, angle: number | undefined): Axis[] {
        if (angle === undefined) {
            return Axis.getAxiesAtPlane(referencePoint, plane);
        } else {
            let result: Axis[] = [];
            let testAngle = 0;
            while (testAngle < 360) {
                let direction = plane.xDirection.rotate(plane.normal, (testAngle / 180) * Math.PI)!;
                result.push(new Axis(referencePoint, direction, `${testAngle} °`));
                testAngle += angle;
            }
            result.push(new Axis(referencePoint, plane.normal, "Z 轴"));
            result.push(new Axis(referencePoint, plane.normal.reverse(), "Z 轴"));
            return result;
        }
    }

    clear(): void {
        this.axies.clear();
    }
}
