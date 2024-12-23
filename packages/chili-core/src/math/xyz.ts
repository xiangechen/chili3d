// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Precision } from "../foundation";
import { Serializer } from "../serialize";
import { MathUtils } from "./mathUtils";

export type XYZLike = { x: number; y: number; z: number };

@Serializer.register(["x", "y", "z"])
export class XYZ {
    static readonly zero = new XYZ(0, 0, 0);
    static readonly unitX = new XYZ(1, 0, 0);
    static readonly unitY = new XYZ(0, 1, 0);
    static readonly unitZ = new XYZ(0, 0, 1);
    static readonly one = new XYZ(1, 1, 1);

    @Serializer.serialze()
    readonly x: number;
    @Serializer.serialze()
    readonly y: number;
    @Serializer.serialze()
    readonly z: number;

    constructor(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    toString() {
        return `${this.x}, ${this.y}, ${this.z}`;
    }

    cross(right: XYZLike): XYZ {
        return new XYZ(
            this.y * right.z - this.z * right.y,
            this.z * right.x - this.x * right.z,
            this.x * right.y - this.y * right.x,
        );
    }

    dot(right: XYZLike): number {
        return this.x * right.x + this.y * right.y + this.z * right.z;
    }

    divided(scalar: number): XYZ | undefined {
        if (Math.abs(scalar) < Precision.Float) {
            return undefined;
        }
        return new XYZ(this.x / scalar, this.y / scalar, this.z / scalar);
    }

    reverse(): XYZ {
        return new XYZ(-this.x, -this.y, -this.z);
    }

    multiply(scalar: number): XYZ {
        return new XYZ(this.x * scalar, this.y * scalar, this.z * scalar);
    }

    sub(right: XYZLike): XYZ {
        return new XYZ(this.x - right.x, this.y - right.y, this.z - right.z);
    }

    add(right: XYZLike): XYZ {
        return new XYZ(this.x + right.x, this.y + right.y, this.z + right.z);
    }

    normalize(): XYZ | undefined {
        let d = this.length();
        if (d < Precision.Float) {
            return undefined;
        }
        return new XYZ(this.x / d, this.y / d, this.z / d);
    }

    distanceTo(right: XYZLike): number {
        let dx = this.x - right.x;
        let dy = this.y - right.y;
        let dz = this.z - right.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    static center(p1: XYZLike, p2: XYZLike): XYZ {
        return new XYZ((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
    }

    lengthSq(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    length(): number {
        return Math.sqrt(this.lengthSq());
    }

    /**
     * Computes the angular value in radians between me and right
     * @param right vector
     * @returns [0, PI]
     */
    angleTo(right: XYZLike): number | undefined {
        if (this.isEqualTo(XYZ.zero) || XYZ.zero.isEqualTo(right)) return undefined;
        let cross = this.cross(right);
        let dot = this.dot(right);
        // tan(x) = |a||b|sin(x) / |a||b|cos(x)
        return Math.atan2(cross.length(), dot);
    }

    /**
     * Computes the angular value in radians between me and right on plane
     * @param right vector
     * @param normal plane normal
     * @returns [0, 2PI]
     */
    angleOnPlaneTo(right: XYZLike, normal: XYZLike): number | undefined {
        let angle = this.angleTo(right);
        if (angle === undefined || XYZ.zero.isEqualTo(normal)) return undefined;
        let vec = this.cross(right).normalize();
        if (vec?.isOppositeTo(normal)) {
            return Math.PI * 2 - angle;
        }

        return angle;
    }

    /**
     *
     * @param normal rotate axis
     * @param angle angular value in radians
     * @returns
     */
    rotate(normal: XYZ, angle: number): XYZ | undefined {
        let n = normal.normalize();
        if (n === undefined) return undefined;
        let cos = Math.cos(angle);
        return this.multiply(cos)
            .add(n.multiply((1 - cos) * n.dot(this)))
            .add(n.cross(this).multiply(Math.sin(angle)));
    }

    isEqualTo(right: XYZLike, tolerance: number = 1e-8) {
        return (
            MathUtils.almostEqual(this.x, right.x, tolerance) &&
            MathUtils.almostEqual(this.y, right.y, tolerance) &&
            MathUtils.almostEqual(this.z, right.z, tolerance)
        );
    }

    isParallelTo(right: XYZLike, tolerance: number = 1e-8): boolean | undefined {
        let angle = this.angleTo(right);
        if (angle === undefined) return undefined;
        return angle <= tolerance || Math.PI - angle <= tolerance;
    }

    isOppositeTo(right: XYZLike, tolerance: number = 1e-8): boolean | undefined {
        let angle = this.angleTo(right);
        if (angle === undefined) return undefined;
        return Math.PI - angle <= tolerance;
    }
}
