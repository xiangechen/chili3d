// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { serializable, serialze } from "../serialize";
import { Plane } from "./plane";
import { XYZ } from "./xyz";

@serializable(["point", "direction"])
export class Line {
    @serialze()
    readonly point: XYZ;
    /**
     * unit vector
     */
    @serialze()
    readonly direction: XYZ;

    constructor(location: XYZ, direction: XYZ) {
        this.point = location;
        const n = direction.normalize();
        if (n === undefined || n.isEqualTo(XYZ.zero)) {
            throw new Error("direction can not be zero");
        }
        this.direction = n;
    }

    intersect(right: Line, tolerance = 1e-6): XYZ | undefined {
        if (this.direction.isParallelTo(right.direction, tolerance)) return undefined;
        const result = this.nearestTo(right);
        const vec = result.sub(right.point);
        if (vec.length() < tolerance) return result;

        return vec.isParallelTo(right.direction, tolerance) ? result : undefined;
    }

    distanceTo(right: Line): number {
        const neareast1 = this.nearestTo(right);
        const neareast2 = right.nearestToPoint(neareast1);
        return neareast1.distanceTo(neareast2);
    }

    nearestTo(right: Line): XYZ {
        const n = right.direction.cross(this.direction).normalize();
        if (n === undefined) return this.nearestToPoint(right.point);
        const normal = n.cross(right.direction).normalize()!;
        const plane = new Plane(right.point, normal, n);
        return plane.intersectLine(this)!;
    }

    nearestToPoint(point: XYZ): XYZ {
        const vec = point.sub(this.point);
        const dot = vec.dot(this.direction);
        return this.point.add(this.direction.multiply(dot));
    }
}
