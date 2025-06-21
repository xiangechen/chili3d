// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../foundation";
import { Plane } from "./plane";
import { XYZ } from "./xyz";

export class PlaneAngle {
    private lastX: number = 1;
    private lastY: number = 0;
    private isNegativeRotation: boolean = false;
    private currentAngle: number = 0;

    get angle() {
        return this.currentAngle;
    }

    constructor(readonly plane: Plane) {}

    movePoint(point: XYZ) {
        const vectorToPoint = point.sub(this.plane.origin);
        const projectionX = vectorToPoint.dot(this.plane.xvec);
        const projectionY = vectorToPoint.dot(this.plane.yvec);

        if (this.isCrossingPositiveXAxis(projectionX, projectionY)) {
            this.isNegativeRotation = !this.isNegativeRotation;
        }

        this.currentAngle = this.calculateAngle(vectorToPoint);
        this.updateLastProjections(projectionX, projectionY);
    }

    private calculateAngle(vector: XYZ): number {
        const angleInRadians = this.plane.xvec.angleOnPlaneTo(vector, this.plane.normal)!;
        const angleInDegrees = (angleInRadians * 180) / Math.PI;
        return this.isNegativeRotation ? angleInDegrees - 360 : angleInDegrees;
    }

    private isCrossingPositiveXAxis(x: number, y: number): boolean {
        const isMovingUpward = this.lastY < -Precision.Distance && y > Precision.Distance;
        const isMovingDownward = this.lastY > -Precision.Distance && y < -Precision.Distance;
        const isCrossingX =
            (isMovingUpward && this.currentAngle < Precision.Angle) ||
            (isMovingDownward && this.currentAngle > -Precision.Angle);

        return isCrossingX && this.lastX > 0 && x > 0;
    }

    private updateLastProjections(x: number, y: number) {
        if (Math.abs(x) > Precision.Distance) this.lastX = x;
        if (Math.abs(y) > Precision.Distance) this.lastY = y;
    }
}
