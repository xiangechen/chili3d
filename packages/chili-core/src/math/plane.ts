// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ISerialize } from "../base";
import { MathUtils } from "./mathUtils";
import { Matrix4 } from "./matrix4";
import { Ray } from "./ray";
import { XYZ } from "./xyz";

export class Plane implements ISerialize {
    static readonly XY: Plane = new Plane(XYZ.zero, XYZ.unitZ, XYZ.unitX);
    static readonly YZ: Plane = new Plane(XYZ.zero, XYZ.unitX, XYZ.unitY);
    static readonly ZX: Plane = new Plane(XYZ.zero, XYZ.unitY, XYZ.unitZ);

    /**
     * unit vector
     */
    readonly normal: XYZ;
    readonly x: XYZ;
    readonly y: XYZ;
    constructor(readonly location: XYZ, normal: XYZ, xDirection: XYZ) {
        let n = normal.normalize(),
            x = xDirection.normalize();
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
        this.x = x;
        this.y = n.cross(x).normalize()!;
    }

    serialize(): Record<string, any> {
        return {
            location: this.location.serialize(),
            normal: this.normal.serialize(),
            x: this.x.serialize(),
        };
    }

    copyTo(location: XYZ) {
        return new Plane(location, this.normal, this.x);
    }

    project(point: XYZ): XYZ {
        let vector = point.sub(this.location);
        let dot = vector.dot(this.normal);
        return this.location.add(vector.sub(this.normal.multiply(dot)));
    }

    transformed(matrix: Matrix4) {
        let location = matrix.ofPoint(this.location);
        let x = matrix.ofVector(this.x);
        let normal = matrix.ofVector(this.normal);
        return new Plane(location, normal, x);
    }

    intersect(ray: Ray, containsExtension: boolean = true): XYZ | undefined {
        let vec = this.location.sub(ray.location);
        if (vec.isEqualTo(XYZ.zero)) return this.location;
        let len = vec.dot(this.normal);
        let dot = ray.direction.dot(this.normal);
        if (MathUtils.almostEqual(dot, 0)) return MathUtils.almostEqual(len, 0) ? ray.location : undefined;
        let t = len / dot;
        if (!containsExtension && t < 0) return undefined;
        return ray.location.add(ray.direction.multiply(t));
    }
}
