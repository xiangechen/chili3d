// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { serializable, serialze } from "../serialize";
import type { Line } from "./line";
import { MathUtils } from "./mathUtils";
import type { Matrix4 } from "./matrix4";
import type { Ray } from "./ray";
import { XYZ } from "./xyz";

@serializable(["origin", "normal", "xvec"])
export class Plane {
    static readonly XY: Plane = new Plane(XYZ.zero, XYZ.unitZ, XYZ.unitX);
    static readonly YZ: Plane = new Plane(XYZ.zero, XYZ.unitX, XYZ.unitY);
    static readonly ZX: Plane = new Plane(XYZ.zero, XYZ.unitY, XYZ.unitZ);

    @serialze()
    readonly origin: XYZ;
    /**
     * unit vector
     */
    @serialze()
    readonly normal: XYZ;
    @serialze()
    readonly xvec: XYZ;
    readonly yvec: XYZ;
    constructor(origin: XYZ, normal: XYZ, xvec: XYZ) {
        this.origin = origin;
        const n = normal.normalize(),
            x = xvec.normalize();
        if (n === undefined || n.isEqualTo(XYZ.zero)) {
            throw new Error("normal can not be zero");
        }
        if (x === undefined || x.isEqualTo(XYZ.zero)) {
            throw new Error("xDirector can not be zero");
        }
        if (n.isParallelTo(x)) {
            throw new Error("xDirector can not parallel normal");
        }
        this.normal = n;
        this.xvec = x;
        this.yvec = n.cross(x).normalize()!;
    }

    translateTo(origin: XYZ) {
        return new Plane(origin, this.normal, this.xvec);
    }

    project(point: XYZ): XYZ {
        const vector = point.sub(this.origin);
        const dot = vector.dot(this.normal);
        return this.origin.add(vector.sub(this.normal.multiply(dot)));
    }

    transformed(matrix: Matrix4) {
        const location = matrix.ofPoint(this.origin);
        const x = matrix.ofVector(this.xvec);
        const normal = matrix.ofVector(this.normal);
        return new Plane(location, normal, x);
    }

    intersectLine(line: Line): XYZ | undefined {
        const t = this.lineIntersectParameter(line);
        if (t === undefined) return undefined;

        return line.point.add(line.direction.multiply(t));
    }

    intersectRay(ray: Ray): XYZ | undefined {
        const t = this.lineIntersectParameter(ray);
        if (t === undefined || t < 0) return undefined;

        return ray.point.add(ray.direction.multiply(t));
    }

    private lineIntersectParameter(line: { point: XYZ; direction: XYZ }) {
        const vec = this.origin.sub(line.point);
        if (vec.isEqualTo(XYZ.zero)) {
            return 0;
        }

        const len = vec.dot(this.normal);
        const dot = line.direction.dot(this.normal); // line parallel to plane
        if (MathUtils.almostEqual(dot, 0)) {
            return MathUtils.almostEqual(len, 0) ? 0 : undefined;
        }

        return len / dot;
    }

    projectDistance(p1: XYZ, p2: XYZ) {
        const dp1 = this.project(p1);
        const dp2 = this.project(p2);
        return dp1.distanceTo(dp2);
    }
}
