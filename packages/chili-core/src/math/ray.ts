// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ClassMap, ISerialize, Serialized, Serializer } from "../serialize";
import { Plane } from "./plane";
import { XYZ } from "./xyz";

@ClassMap.key("Ray")
export class Ray implements ISerialize {
    /**
     * unit vector
     */
    readonly direction: XYZ;

    constructor(
        readonly location: XYZ,
        direction: XYZ,
    ) {
        let n = direction.normalize();
        if (n === undefined || n.isEqualTo(XYZ.zero)) {
            throw new Error("direction can not be zero");
        }
        this.direction = n;
    }

    serialize(): Serialized {
        return {
            classKey: "Ray",
            constructorParameters: {
                location: this.location.serialize(),
                direction: this.direction.serialize(),
            },
            properties: {},
        };
    }

    @Serializer.deserializer()
    static from({ direction, location }: { direction: XYZ; location: XYZ }) {
        return new Ray(location, direction);
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
