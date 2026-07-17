// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "../src";
import { XYZEqualityComparer } from "../src/foundation/comparers/XYZEqualityComparer";

describe("XYZEqualityComparer", () => {
    describe("default tolerance", () => {
        test("should return true for identical points", () => {
            const comparer = new XYZEqualityComparer();
            const p1 = new XYZ({ x: 1, y: 2, z: 3 });
            const p2 = new XYZ({ x: 1, y: 2, z: 3 });
            expect(comparer.equals(p1, p2)).toBeTruthy();
        });

        test("should return true for points within default tolerance", () => {
            const comparer = new XYZEqualityComparer();
            const p1 = new XYZ({ x: 1, y: 2, z: 3 });
            const p2 = new XYZ({ x: 1.000000000001, y: 2, z: 3 });
            expect(comparer.equals(p1, p2)).toBeTruthy();
        });

        test("should return false for points outside default tolerance", () => {
            const comparer = new XYZEqualityComparer();
            const p1 = new XYZ({ x: 1, y: 2, z: 3 });
            const p2 = new XYZ({ x: 2, y: 3, z: 4 });
            expect(comparer.equals(p1, p2)).toBeFalsy();
        });

        test("should return true for zero points", () => {
            const comparer = new XYZEqualityComparer();
            expect(comparer.equals(XYZ.zero, XYZ.zero)).toBeTruthy();
        });

        test("should return false for zero vs unit", () => {
            const comparer = new XYZEqualityComparer();
            expect(comparer.equals(XYZ.zero, XYZ.unitX)).toBeFalsy();
        });
    });

    describe("custom tolerance", () => {
        test("should use custom tolerance when provided", () => {
            const comparer = new XYZEqualityComparer(0.1);
            const p1 = new XYZ({ x: 1, y: 2, z: 3 });
            const p2 = new XYZ({ x: 1.05, y: 2.05, z: 3.05 });
            expect(comparer.equals(p1, p2)).toBeTruthy();
        });

        test("should reject with strict tolerance", () => {
            const comparer = new XYZEqualityComparer(1e-12);
            const p1 = new XYZ({ x: 1, y: 2, z: 3 });
            const p2 = new XYZ({ x: 1, y: 2, z: 3.0000001 });
            expect(comparer.equals(p1, p2)).toBeFalsy();
        });

        test("zero tolerance uses strict inequality", () => {
            // XYZ.isEqualTo uses almostEqual which does Math.abs(a-b) < tolerance,
            // so tolerance 0 means 0 < 0 = false even for identical values
            const comparer = new XYZEqualityComparer(0);
            const p1 = new XYZ({ x: 1, y: 2, z: 3 });
            const p2 = new XYZ({ x: 1, y: 2, z: 3 });
            expect(comparer.equals(p1, p2)).toBe(false);
        });
    });
});
