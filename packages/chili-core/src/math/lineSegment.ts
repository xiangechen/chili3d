// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../foundation/precision";
import { serializable, serialze } from "../serialize";
import type { XYZ } from "./xyz";

@serializable(["start", "end"])
export class LineSegment {
    @serialze()
    readonly start: XYZ;

    @serialze()
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

    /**
     * Calculates the shortest distance between this line segment and another line segment.
     *
     * This method computes the closest points on both segments and returns the distance
     * between them along with the parametric coordinates of the closest points.
     *
     * Algorithm:
     * 1. Compute direction vectors u and v for both segments
     * 2. Calculate the discriminant D = |u|²|v|² - (u·v)² which determines if segments are parallel
     * 3. Handle parallel and non-parallel cases separately
     * 4. Clamp parameters to [0,1] to stay within segment bounds
     *
     * @param right - The other line segment to compute distance to
     * @returns Object containing:
     *   - pointOnThis: Closest point on this segment
     *   - pointOnRight: Closest point on the other segment
     *   - distance: Euclidean distance between the closest points
     *   - sc: Parametric coordinate of closest point on this segment (0=start, 1=end)
     *   - tc: Parametric coordinate of closest point on other segment (0=start, 1=end)
     */
    distanceTo(right: LineSegment) {
        const u = this.end.sub(this.start);
        const v = right.end.sub(right.start);
        const w = this.start.sub(right.start);

        const { sN, sD, tN, tD } = this.calculateParameters(u, v, w);

        const sc = Math.abs(sN) < Precision.Float && sD !== 0 ? 0.0 : sN / sD;
        const tc = Math.abs(tN) < Precision.Float && tD !== 0 ? 0.0 : tN / tD;

        const pointOnThis = this.start.add(u.multiply(sc));
        const pointOnRight = right.start.add(v.multiply(tc));
        const distance = pointOnThis.distanceTo(pointOnRight);

        return { pointOnThis, pointOnRight, distance, sc, tc };
    }

    private calculateParameters(u: XYZ, v: XYZ, w: XYZ) {
        const a = u.dot(u);
        const b = u.dot(v);
        const c = v.dot(v);
        const d = u.dot(w);
        const e = v.dot(w);

        // D is the discriminant of the quadratic form used to find closest points
        // It is proportional to the square of the sine of the angle between the two direction vectors
        // D = |u|²|v|² - (u·v)² = |u|²|v|²(1 - cos²θ) = |u|²|v|²sin²θ
        // When D ≈ 0, the lines are nearly parallel (sin θ ≈ 0)
        // When D > 0, the lines are not parallel and we can find unique closest points on infinite lines
        const D = a * c - b * b;

        if (D < Precision.Float) {
            // the lines are almost parallel
            return this.calculateParallelSegments(a, c, d, e);
        } else {
            return this.calculateNonParallelSegments(D, a, b, c, d, e);
        }
    }

    private calculateParallelSegments(a: number, c: number, d: number, e: number) {
        // Force using point P0 on segment S1
        // to prevent possible division by 0.0 later
        const sN = 0.0;
        const sD = 1.0;
        const tN = e;
        const tD = c;

        return this.checkParameterConstraints(tN, tD, sN, sD, -d, a);
    }

    private calculateNonParallelSegments(D: number, a: number, b: number, c: number, d: number, e: number) {
        let sN = b * e - c * d;
        const sD = D; // sc = sN / sD, default sD = D >= 0
        let tN = a * e - b * d;
        let tD = D; // tc = tN / tD, default tD = D >= 0

        if (sN < 0.0) {
            // sc < 0 => the s=0 edge is visible
            sN = 0.0;
            tN = e;
            tD = c;
        } else if (sN > sD) {
            // sc > 1  => the s=1 edge is visible
            sN = sD;
            tN = e + b;
            tD = c;
        }

        return this.checkParameterConstraints(tN, tD, sN, sD, -d, a, b);
    }

    private checkParameterConstraints(
        tN: number,
        tD: number,
        sN: number,
        sD: number,
        negD: number,
        a: number,
        b?: number,
    ) {
        if (tN < 0.0) {
            // tc < 0 => the t=0 edge is visible
            tN = 0.0;
            if (negD < 0.0) {
                sN = 0.0;
            } else if (negD > a) {
                sN = sD;
            } else {
                sN = negD;
                sD = a;
            }
        } else if (tN > tD) {
            // tc > 1  => the t=1 edge is visible
            tN = tD;
            const negDB = b !== undefined ? negD + b : negD;
            if (negDB < 0.0) {
                sN = 0.0;
            } else if (negDB > a) {
                sN = sD;
            } else {
                sN = negDB;
                sD = a;
            }
        }
        return { tN, tD, sN, sD };
    }
}
