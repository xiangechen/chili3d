// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Precision } from "../foundation";

export class MathUtils {
    static degToRad(degrees: number) {
        return (degrees * Math.PI) / 180;
    }

    static radToDeg(radians: number) {
        return (radians * 180) / Math.PI;
    }

    static anyEqualZero(...numbers: number[]) {
        return numbers.some((x) => Math.abs(x) < Precision.Float);
    }

    static allEqualZero(...numbers: number[]) {
        return !numbers.some((x) => Math.abs(x) > Precision.Float);
    }

    static almostEqual(left: number, right: number, tolerance: number = 1e-8) {
        return Math.abs(left - right) < tolerance;
    }

    static clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }

    static minMax(arr: number[]) {
        if (arr.length === 0) return undefined;
        let minMax = arr.reduce(
            ([min, max], val) => [Math.min(min, val), Math.max(max, val)],
            [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
        );
        return {
            min: minMax[0],
            max: minMax[1],
        };
    }
}
