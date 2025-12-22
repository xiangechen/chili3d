// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../foundation/precision";
import { Serializer } from "../serialize";
import type { XYZ } from "./xyz";

@Serializer.register(["start", "end"])
export class LineSegment {
    @Serializer.serialze()
    readonly start: XYZ;

    @Serializer.serialze()
    readonly end: XYZ;

    constructor(start: XYZ, end: XYZ) {
        this.start = start;
        this.end = end;

        if (start.isEqualTo(end)) {
            throw new Error("start and end can not be equal");
        }
    }

    distanceToPoint(point: XYZ): number {
        const segmentVector = this.end.sub(this.start);
        const pointVector = point.sub(this.start);

        const segmentLengthSquared = segmentVector.dot(segmentVector);
        const projection = pointVector.dot(segmentVector);

        // Parameter t represents where the projected point lies on the segment
        // t = 0 at start, t = 1 at end
        const t = Math.max(0, Math.min(1, projection / segmentLengthSquared));

        const closestPoint = this.start.add(segmentVector.multiply(t));
        return point.distanceTo(closestPoint);
    }

    distanceTo(right: LineSegment): number {
        const u = this.end.sub(this.start);
        const v = right.end.sub(right.start);
        const w = this.start.sub(right.start);

        const a = u.dot(u); // always >= 0
        const b = u.dot(v);
        const c = v.dot(v); // always >= 0
        const d = u.dot(w);
        const e = v.dot(w);
        const D = a * c - b * b; // always >= 0

        // Compute the line parameters of the two closest points
        let sN: number;
        let sD = D; // sc = sN / sD, default sD = D >= 0
        let tN: number;
        let tD = D; // tc = tN / tD, default tD = D >= 0

        // Compute the closest points on the two segments
        if (D < Precision.Float) {
            // The lines are almost parallel
            sN = 0.0;
            sD = 1.0; // force using point P0 on segment S1
            tN = e;
            tD = c;
        } else {
            // Get the closest points on the infinite lines
            sN = b * e - c * d;
            tN = a * e - b * d;

            if (sN < 0.0) {
                // sc < 0 => the s=0 edge is visible
                sN = 0.0;
                tN = e;
                tD = c;
            } else if (sN > sD) {
                // sc > 1 => the s=1 edge is visible
                sN = sD;
                tN = e + b;
                tD = c;
            }
        }

        if (tN < 0.0) {
            // tc < 0 => the t=0 edge is visible
            tN = 0.0;
            if (-d < 0.0) sN = 0.0;
            else if (-d > a) sN = sD;
            else {
                sN = -d;
                sD = a;
            }
        } else if (tN > tD) {
            // tc > 1 => the t=1 edge is visible
            tN = tD;
            if (-d + b < 0.0) sN = 0;
            else if (-d + b > a) sN = sD;
            else {
                sN = -d + b;
                sD = a;
            }
        }

        // Finally do the division to get sc and tc
        const sc = Math.abs(sN) < Precision.Float ? 0.0 : sN / sD;
        const tc = Math.abs(tN) < Precision.Float ? 0.0 : tN / tD;

        // Get the difference of the two closest points
        const dP = w.add(u.multiply(sc)).sub(v.multiply(tc));
        return dP.length();
    }
}
