// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Plane, XYZ } from "chili-core";

export class Ray {
    /**
     * unit vector
     */
    readonly direction: XYZ;

    constructor(readonly location: XYZ, direction: XYZ) {
        let n = direction.normalize();
        if (n === undefined || n.isEqualTo(XYZ.zero)) {
            throw new Error("direction can not be zero");
        }
        this.direction = n;
    }

    intersect(right: Ray): XYZ | undefined {
        if (this.direction.isParallelTo(right.direction)) return undefined;
        let result = this.nearestTo(right);
        let vec = result.sub(right.location);
        if (vec.isParallelTo(right.direction)) return result;
        return undefined;
    }

    nearestTo(right: Ray): XYZ {
        let n = right.direction.cross(this.direction).normalize();
        if (n === undefined) return this.nearestToPoint(right.location);
        let normal = n.cross(right.direction).normalize()!;
        let plane = new Plane(right.location, normal, n);
        return plane.intersect(this)!;
    }

    nearestToPoint(point: XYZ): XYZ {
        let vec = point.sub(this.location);
        let dot = vec.dot(this.direction);
        return this.location.add(this.direction.multiply(dot));
    }
}
