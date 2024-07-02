// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Serializer } from "../serialize";
import { MathUtils } from "./mathUtils";
import { Matrix4 } from "./matrix4";
import { Ray } from "./ray";
import { XYZ } from "./xyz";

@Serializer.register(["origin", "normal", "xvec"])
export class Plane {
    static readonly XY: Plane = new Plane(XYZ.zero, XYZ.unitZ, XYZ.unitX);
    static readonly YZ: Plane = new Plane(XYZ.zero, XYZ.unitX, XYZ.unitY);
    static readonly ZX: Plane = new Plane(XYZ.zero, XYZ.unitY, XYZ.unitZ);

    @Serializer.serialze()
    readonly origin: XYZ;
    /**
     * unit vector
     */
    @Serializer.serialze()
    readonly normal: XYZ;
    @Serializer.serialze()
    readonly xvec: XYZ;
    readonly yvec: XYZ;
    constructor(origin: XYZ, normal: XYZ, xvec: XYZ) {
        this.origin = origin;
        let n = normal.normalize(),
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
        let vector = point.sub(this.origin);
        let dot = vector.dot(this.normal);
        return this.origin.add(vector.sub(this.normal.multiply(dot)));
    }

    transformed(matrix: Matrix4) {
        let location = matrix.ofPoint(this.origin);
        let x = matrix.ofVector(this.xvec);
        let normal = matrix.ofVector(this.normal);
        return new Plane(location, normal, x);
    }

    intersect(ray: Ray, containsExtension: boolean = true): XYZ | undefined {
        let vec = this.origin.sub(ray.location);
        if (vec.isEqualTo(XYZ.zero)) return this.origin;
        let len = vec.dot(this.normal);
        let dot = ray.direction.dot(this.normal);
        if (MathUtils.almostEqual(dot, 0)) return MathUtils.almostEqual(len, 0) ? ray.location : undefined;
        let t = len / dot;
        if (!containsExtension && t < 0) return undefined;
        return ray.location.add(ray.direction.multiply(t));
    }
}
