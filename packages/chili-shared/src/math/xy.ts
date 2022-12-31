// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { MathUtils } from "./mathUtils";

export class XY {
    static readonly zero = Object.freeze(new XY(0, 0));
    static readonly unitX = Object.freeze(new XY(1, 0));
    static readonly unitY = Object.freeze(new XY(0, 1));

    constructor(public x: number, public y: number) {}

    cross(right: XY): number {
        return this.x * right.y - this.y * right.x;
    }

    dot(right: XY): number {
        return this.x * right.x + this.y * right.y;
    }

    divided(scalar: number): XY | undefined {
        if (Math.abs(scalar) < MathUtils.Resolution) {
            return undefined;
        }
        return new XY(this.x / scalar, this.y / scalar);
    }

    reverse(): XY {
        return new XY(-this.x, -this.y);
    }

    multiply(scalar: number): XY {
        return new XY(this.x * scalar, this.y * scalar);
    }

    sub(right: XY): XY {
        return new XY(this.x - right.x, this.y - right.y);
    }

    add(right: XY): XY {
        return new XY(this.x + right.x, this.y + right.y);
    }

    normalize(): XY | undefined {
        let d = this.length();
        if (d < MathUtils.Resolution) {
            return undefined;
        }
        return new XY(this.x / d, this.y / d);
    }

    distanceTo(right: XY): number {
        let dx = this.x - right.x;
        let dy = this.y - right.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    static center(p1: XY, p2: XY): XY {
        return new XY((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    }

    lengthSq(): number {
        return this.x * this.x + this.y * this.y;
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
        return MathUtils.almostEqual(this.x, right.x, tolerance) && MathUtils.almostEqual(this.y, right.y, tolerance);
    }

    isParallelTo(right: XY, tolerance: number = 1e-8): boolean | undefined {
        let angle = this.angleTo(right);
        if (angle === undefined) return undefined;
        return angle <= tolerance || Math.PI - angle <= tolerance;
    }

    isOppositeTo(right: XY, tolerance: number = 1e-8): boolean | undefined {
        let angle = this.angleTo(right);
        if (angle === undefined) return undefined;
        return Math.PI - angle <= tolerance;
    }
}
