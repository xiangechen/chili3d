// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "../src";

describe("Precision", () => {
    describe("Distance", () => {
        test("should be a positive small number", () => {
            expect(Precision.Distance).toBeGreaterThan(0);
            expect(Precision.Distance).toBeLessThan(1e-5);
        });

        test("should be 1e-7", () => {
            expect(Precision.Distance).toBe(1e-7);
        });
    });

    describe("Angle", () => {
        test("should be a positive small number", () => {
            expect(Precision.Angle).toBeGreaterThan(0);
            expect(Precision.Angle).toBeLessThan(1e-1);
        });

        test("should be 1e-3", () => {
            expect(Precision.Angle).toBe(1e-3);
        });
    });

    describe("Float", () => {
        test("should be a positive small number", () => {
            expect(Precision.Float).toBeGreaterThan(0);
            expect(Precision.Float).toBeLessThan(1e-5);
        });

        test("should be 1e-7", () => {
            expect(Precision.Float).toBe(1e-7);
        });
    });

    describe("usage in comparisons", () => {
        test("Distance should distinguish close points", () => {
            const a = 0;
            const b = 1e-8;
            expect(Math.abs(a - b) < Precision.Distance).toBe(true);
        });

        test("Distance should distinguish far points", () => {
            const a = 0;
            const b = 1e-5;
            expect(Math.abs(a - b) < Precision.Distance).toBe(false);
        });

        test("Float should detect near-zero values", () => {
            const almostZero = 1e-8;
            expect(Math.abs(almostZero) < Precision.Float).toBe(true);
        });

        test("Float should not treat significant values as zero", () => {
            const significantValue = 1e-5;
            expect(Math.abs(significantValue) < Precision.Float).toBe(false);
        });
    });
});
