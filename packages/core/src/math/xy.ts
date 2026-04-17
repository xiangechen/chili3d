// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../foundation";
import { serializable, serialize } from "../serialize";
import { MathUtils } from "./mathUtils";

export type XYLike = { x: number; y: number };

export interface XYOptions {
    x: number;
    y: number;
}

@serializable()
export class XY {
    static readonly zero = new XY({ x: 0, y: 0 });
    static readonly unitX = new XY({ x: 1, y: 0 });
    static readonly unitY = new XY({ x: 0, y: 1 });

    @serialize()
    readonly x: number;
    @serialize()
    readonly y: number;

    constructor(options: XYOptions) {
        this.x = options.x;
        this.y = options.y;
    }

    cross(right: XY): number {
        return this.x * right.y - this.y * right.x;
    }

    dot(right: XY): number {
        return this.x * right.x + this.y * right.y;
    }

    divided(scalar: number): XY | undefined {
        return Math.abs(scalar) < Precision.Float
            ? undefined
            : new XY({ x: this.x / scalar, y: this.y / scalar });
    }

    reverse(): XY {
        return new XY({ x: -this.x, y: -this.y });
    }

    multiply(scalar: number): XY {
        return new XY({ x: this.x * scalar, y: this.y * scalar });
    }

    sub(right: XY): XY {
        return new XY({ x: this.x - right.x, y: this.y - right.y });
    }

    add(right: XY): XY {
        return new XY({ x: this.x + right.x, y: this.y + right.y });
    }

    normalize(): XY | undefined {
        const d = this.length();
        return d < Precision.Float ? undefined : new XY({ x: this.x / d, y: this.y / d });
    }

    distanceTo(right: XY): number {
        const dx = this.x - right.x;
        const dy = this.y - right.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    static center(p1: XY, p2: XY): XY {
        return new XY({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
    }

    lengthSq(): number {
        return this.x ** 2 + this.y ** 2;
    }

    length(): number {
        return Math.sqrt(this.lengthSq());
    }

    /**
     * Computes the angular value in radians between me and right
     * @param right vector
     * @returns [0, PI]
     */
    angleTo(right: XY): number | undefined {
        if (this.isEqualTo(XY.zero) || right.isEqualTo(XY.zero)) return undefined;
        // tan(x) = |a||b|sin(x) / |a||b|cos(x)
        return Math.atan2(this.cross(right), this.dot(right));
    }

    isEqualTo(right: XY, tolerance: number = 1e-8) {
        return (
            MathUtils.almostEqual(this.x, right.x, tolerance) &&
            MathUtils.almostEqual(this.y, right.y, tolerance)
        );
    }

    isParallelTo(right: XY, tolerance: number = 1e-8): boolean | undefined {
        const angle = this.angleTo(right);
        return angle === undefined ? undefined : angle <= tolerance || Math.PI - angle <= tolerance;
    }

    isOppositeTo(right: XY, tolerance: number = 1e-8): boolean | undefined {
        const angle = this.angleTo(right);
        return angle === undefined ? undefined : Math.PI - angle <= tolerance;
    }
}
