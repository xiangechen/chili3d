// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../foundation";
import { serializable, serialize } from "../serialize";
import { MathUtils } from "./mathUtils";

export type XYZLike = { x: number; y: number; z: number };

export interface XYZOptions {
    x: number;
    y: number;
    z: number;
}

/**
 * Gets the component value of a vector at the specified index
 *
 * @param point - An XYZLike object containing x, y, z properties
 * @param index - The index of the component to retrieve (0 for x, 1 for y, 2 for z)
 * @returns The component value at the specified index
 * @throws Error when index is out of valid range (0-2)
 */
export function getVectorComponent(point: XYZLike, index: number) {
    if (index === 0) {
        return point.x;
    } else if (index === 1) {
        return point.y;
    } else if (index === 2) {
        return point.z;
    }

    throw new Error("index out of range");
}

@serializable()
export class XYZ {
    static readonly zero = Object.freeze(new XYZ({ x: 0, y: 0, z: 0 }));
    static readonly unitX = Object.freeze(new XYZ({ x: 1, y: 0, z: 0 }));
    static readonly unitY = Object.freeze(new XYZ({ x: 0, y: 1, z: 0 }));
    static readonly unitZ = Object.freeze(new XYZ({ x: 0, y: 0, z: 1 }));
    static readonly unitNX = Object.freeze(new XYZ({ x: -1, y: 0, z: 0 }));
    static readonly unitNY = Object.freeze(new XYZ({ x: 0, y: -1, z: 0 }));
    static readonly unitNZ = Object.freeze(new XYZ({ x: 0, y: 0, z: -1 }));
    static readonly one = Object.freeze(new XYZ({ x: 1, y: 1, z: 1 }));

    @serialize()
    readonly x: number;
    @serialize()
    readonly y: number;
    @serialize()
    readonly z: number;

    constructor(options: XYZOptions) {
        this.x = options.x;
        this.y = options.y;
        this.z = options.z;

        if (Number.isNaN(this.x) || Number.isNaN(this.y) || Number.isNaN(this.z)) {
            throw new Error("NaN in XYZ");
        }
    }

    toString() {
        return `${this.x}, ${this.y}, ${this.z}`;
    }

    toArray(): number[] {
        return [this.x, this.y, this.z];
    }

    static fromArray(arr: number[]) {
        if (!arr) return XYZ.zero;

        const x = arr.at(0) ?? 0;
        const y = arr.at(1) ?? 0;
        const z = arr.at(2) ?? 0;
        return new XYZ({ x, y, z });
    }

    cross(right: XYZLike): XYZ {
        return new XYZ({
            x: this.y * right.z - this.z * right.y,
            y: this.z * right.x - this.x * right.z,
            z: this.x * right.y - this.y * right.x,
        });
    }

    dot(right: XYZLike): number {
        return this.x * right.x + this.y * right.y + this.z * right.z;
    }

    divided(scalar: number): XYZ | undefined {
        if (Math.abs(scalar) < Precision.Float) return undefined;
        return new XYZ({ x: this.x / scalar, y: this.y / scalar, z: this.z / scalar });
    }

    reverse(): XYZ {
        const x = MathUtils.almostEqual(this.x, 0) ? 0 : -this.x;
        const y = MathUtils.almostEqual(this.y, 0) ? 0 : -this.y;
        const z = MathUtils.almostEqual(this.z, 0) ? 0 : -this.z;

        return new XYZ({ x, y, z });
    }

    multiply(scalar: number): XYZ {
        return new XYZ({ x: this.x * scalar, y: this.y * scalar, z: this.z * scalar });
    }

    sub(right: XYZLike): XYZ {
        return new XYZ({ x: this.x - right.x, y: this.y - right.y, z: this.z - right.z });
    }

    add(right: XYZLike): XYZ {
        return new XYZ({ x: this.x + right.x, y: this.y + right.y, z: this.z + right.z });
    }

    normalize(): XYZ | undefined {
        const d = this.length();
        return d < Precision.Float ? undefined : new XYZ({ x: this.x / d, y: this.y / d, z: this.z / d });
    }

    distanceTo(right: XYZLike): number {
        const dx = this.x - right.x;
        const dy = this.y - right.y;
        const dz = this.z - right.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    static center(p1: XYZLike, p2: XYZLike): XYZ {
        return new XYZ({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: (p1.z + p2.z) / 2 });
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
        const cross = this.cross(right);
        const dot = this.dot(right);
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
        const angle = this.angleTo(right);
        if (angle === undefined || XYZ.zero.isEqualTo(normal)) return undefined;
        const vec = this.cross(right).normalize();
        return vec?.isOppositeTo(normal) ? Math.PI * 2 - angle : angle;
    }

    /**
     *
     * @param normal rotate axis
     * @param angle angular value in radians
     * @returns
     */
    rotate(normal: XYZ, angle: number): XYZ | undefined {
        const n = normal.normalize();
        if (n === undefined) return undefined;
        const cos = Math.cos(angle);
        return this.multiply(cos)
            .add(n.multiply((1 - cos) * n.dot(this)))
            .add(n.cross(this).multiply(Math.sin(angle)));
    }

    isEqualTo(right: XYZLike, tolerance: number = 1e-6) {
        return (
            MathUtils.almostEqual(this.x, right.x, tolerance) &&
            MathUtils.almostEqual(this.y, right.y, tolerance) &&
            MathUtils.almostEqual(this.z, right.z, tolerance)
        );
    }

    isPerpendicularTo(right: XYZLike, tolerance: number = 1e-6): boolean {
        const angle = this.angleTo(right);
        if (angle === undefined) return false;

        return Math.abs(angle - Math.PI * 0.5) < tolerance;
    }

    isParallelTo(right: XYZLike, tolerance: number = 1e-6): boolean {
        const angle = this.angleTo(right);
        if (angle === undefined) return false;

        return Math.abs(angle) < tolerance || Math.abs(Math.PI - angle) < tolerance;
    }

    isOppositeTo(right: XYZLike, tolerance: number = 1e-6): boolean {
        const angle = this.angleTo(right);
        if (angle === undefined) return false;

        return Math.abs(Math.PI - angle) < tolerance;
    }
}
