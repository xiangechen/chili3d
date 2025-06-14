// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Serializer } from "../serialize";
import { Plane } from "./plane";
import { XYZ } from "./xyz";

@Serializer.register(["location", "direction"])
export class Ray {
    @Serializer.serialze()
    readonly location: XYZ;
    /**
     * unit vector
     */
    @Serializer.serialze()
    readonly direction: XYZ;

    constructor(location: XYZ, direction: XYZ) {
        this.location = location;
        const n = direction.normalize();
        if (n === undefined || n.isEqualTo(XYZ.zero)) {
            throw new Error("direction can not be zero");
        }
        this.direction = n;
    }

    intersect(right: Ray): XYZ | undefined {
        if (this.direction.isParallelTo(right.direction)) return undefined;
        const result = this.nearestTo(right);
        const vec = result.sub(right.location);
        return vec.isParallelTo(right.direction) ? result : undefined;
    }

    distanceTo(right: Ray): number {
        const neareast1 = this.nearestTo(right);
        const neareast2 = this.nearestToPoint(neareast1);
        return neareast1.distanceTo(neareast2);
    }

    nearestTo(right: Ray): XYZ {
        const n = right.direction.cross(this.direction).normalize();
        if (n === undefined) return this.nearestToPoint(right.location);
        const normal = n.cross(right.direction).normalize()!;
        const plane = new Plane(right.location, normal, n);
        return plane.intersect(this)!;
    }

    nearestToPoint(point: XYZ): XYZ {
        const vec = point.sub(this.location);
        const dot = vec.dot(this.direction);
        return this.location.add(this.direction.multiply(dot));
    }
}
