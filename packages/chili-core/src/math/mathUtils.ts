// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../foundation";

export class MathUtils {
    static degToRad(degrees: number) {
        return degrees * (Math.PI / 180);
    }

    static radToDeg(radians: number) {
        return radians * (180 / Math.PI);
    }

    static anyEqualZero(...values: number[]) {
        return values.some((value) => Math.abs(value) < Precision.Float);
    }

    static allEqualZero(...values: number[]) {
        return values.every((value) => Math.abs(value) < Precision.Float);
    }

    static almostEqual(a: number, b: number, tolerance = 1e-6) {
        return Math.abs(a - b) < tolerance;
    }

    static clamp(value: number, min: number, max: number) {
        return Math.max(min, Math.min(max, value));
    }

    static minMax(values: ArrayLike<number>) {
        if (values.length === 0) return undefined;

        let min = values[0];
        let max = values[0];

        for (let i = 1; i < values.length; i++) {
            const value = values[i];
            if (value < min) min = value;
            if (value > max) max = value;
        }

        return { min, max };
    }
}
