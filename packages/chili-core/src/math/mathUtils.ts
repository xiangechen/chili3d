// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Precision } from "../base";

export class MathUtils {
    static degToRad(degrees: number) {
        return (degrees * Math.PI) / 180;
    }

    static radToDeg(radians: number) {
        return (radians * 180) / Math.PI;
    }

    static anyEqualZero(...numbers: number[]) {
        return numbers.some((x) => Math.abs(x) < Precision.Number);
    }

    static allEqualZero(...numbers: number[]) {
        return !numbers.some((x) => Math.abs(x) > Precision.Number);
    }

    static almostEqual(left: number, right: number, tolerance: number = 1e-8) {
        return Math.abs(left - right) < tolerance;
    }

    static clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }
}
