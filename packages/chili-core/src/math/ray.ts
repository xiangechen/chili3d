// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
