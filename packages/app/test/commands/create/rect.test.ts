// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, XYZ } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { getReactData, Rect } from "../../../src/commands/create/rect";

describe("getReactData", () => {
    test("should compute rect data for axis-aligned plane", () => {
        const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const start = XYZ.zero;
        const end = new XYZ({ x: 10, y: 5, z: 0 });

        const result = getReactData(plane, start, end);

        expect(result.dx).toBeCloseTo(10);
        expect(result.dy).toBeCloseTo(5);
        expect(result.plane.origin.x).toBeCloseTo(0);
        expect(result.plane.origin.y).toBeCloseTo(0);
        expect(result.plane.origin.z).toBeCloseTo(0);
        expect(result.plane.normal.isEqualTo(plane.normal)).toBe(true);
    });

    test("should compute rect data for non-zero start point", () => {
        const normal = XYZ.unitZ;
        const xvec = XYZ.unitX;
        const plane = new Plane({ origin: new XYZ({ x: 2, y: 3, z: 0 }), normal, xvec });
        const start = new XYZ({ x: 2, y: 3, z: 0 });
        const end = new XYZ({ x: 8, y: 7, z: 0 });

        const result = getReactData(plane, start, end);

        expect(result.dx).toBeCloseTo(6);
        expect(result.dy).toBeCloseTo(4);
    });

    test("should compute negative dimensions", () => {
        const plane = new Plane({ origin: XYZ.zero, normal: XYZ.unitZ, xvec: XYZ.unitX });
        const start = XYZ.zero;
        const end = new XYZ({ x: -5, y: -10, z: 0 });

        const result = getReactData(plane, start, end);

        expect(result.dx).toBeCloseTo(-5);
        expect(result.dy).toBeCloseTo(-10);
    });
});

describe("Rect", () => {
    test("should have command metadata", () => {
        const data = (Rect as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.rect");
        expect(data.icon).toBe("icon-rect");
    });

    test("isFace should default to true", () => {
        const cmd = new Rect();
        expect(cmd.isFace).toBe(true);
    });

    test("isFace setter should update property", () => {
        const cmd = new Rect();
        cmd.isFace = false;
        expect(cmd.isFace).toBe(false);
    });

    test("centerRect should default to false", () => {
        const cmd = new Rect();
        expect(cmd.centerRect).toBe(false);
    });

    test("centerRect setter should update property", () => {
        const cmd = new Rect();
        cmd.centerRect = true;
        expect(cmd.centerRect).toBe(true);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Rect();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
