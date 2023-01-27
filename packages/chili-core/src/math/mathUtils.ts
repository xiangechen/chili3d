// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { XYZ } from "./xyz";

export interface Axis {
    location: XYZ;
    direction: XYZ;
}

export interface Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
}

export class MathUtils {
    static readonly Resolution = 1e-8;

    static anyEqualZero(...numbers: number[]) {
        return numbers.some((x) => Math.abs(x) < this.Resolution);
    }

    static allEqualZero(...numbers: number[]) {
        return !numbers.some((x) => Math.abs(x) > this.Resolution);
    }

    static almostEqual(left: number, right: number, tolerance: number = 1e-8) {
        return Math.abs(left - right) < tolerance;
    }

    static clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }
}
