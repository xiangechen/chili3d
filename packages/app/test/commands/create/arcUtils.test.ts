// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { computeArcFromPoints, computeCircleFromPoints } from "../../../src/commands/create/arcUtils";

describe("computeCircleFromPoints", () => {
    test("should compute circle from three non-collinear points", () => {
        const A = new XYZ({ x: 1, y: 0, z: 0 });
        const B = new XYZ({ x: 0, y: 1, z: 0 });
        const C = new XYZ({ x: -1, y: 0, z: 0 });

        const result = computeCircleFromPoints(A, B, C);
        expect(result).toBeDefined();
        if (result) {
            // Center should be at origin for these symmetric points
            expect(Math.abs(result.center.x)).toBeLessThan(0.001);
            expect(Math.abs(result.center.y)).toBeLessThan(0.001);
            expect(Math.abs(result.center.z)).toBeLessThan(0.001);
            // Normal should be z-axis
            expect(Math.abs(Math.abs(result.normal.z) - 1)).toBeLessThan(0.001);
        }
    });

    test("should return undefined for collinear points", () => {
        const A = new XYZ({ x: 0, y: 0, z: 0 });
        const B = new XYZ({ x: 1, y: 0, z: 0 });
        const C = new XYZ({ x: 2, y: 0, z: 0 });

        const result = computeCircleFromPoints(A, B, C);
        expect(result).toBeUndefined();
    });
});

describe("computeArcFromPoints", () => {
    test("should compute arc from three non-collinear points", () => {
        const A = new XYZ({ x: 1, y: 0, z: 0 });
        const B = new XYZ({ x: 0, y: 1, z: 0 });
        const C = new XYZ({ x: -1, y: 0, z: 0 });

        const result = computeArcFromPoints(A, B, C);
        expect(result).toBeDefined();
        if (result) {
            expect(Math.abs(result.center.x)).toBeLessThan(0.001);
            expect(Math.abs(result.center.y)).toBeLessThan(0.001);
            // Start point should be A
            expect(result.start).toBe(A);
        }
    });

    test("should return undefined for collinear points", () => {
        const A = new XYZ({ x: 0, y: 0, z: 0 });
        const B = new XYZ({ x: 1, y: 0, z: 0 });
        const C = new XYZ({ x: 2, y: 0, z: 0 });

        const result = computeArcFromPoints(A, B, C);
        expect(result).toBeUndefined();
    });
});
