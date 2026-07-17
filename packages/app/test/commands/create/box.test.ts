// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Plane, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { BoxNode } from "../../../src/bodys/box";
import { Box } from "../../../src/commands/create/box";
import {
    ensureGlobalStubApp,
    PLANE_XY,
    pointStepResult,
    seedStepDatas,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Box", () => {
    test("should have command metadata", () => {
        const data = (Box as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.box");
        expect(data.icon).toBe("icon-box");
    });

    test("getSteps should return three steps (two from RectCommandBase + height)", () => {
        const cmd = new Box();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    function boxWithThreePoints(base: XYZ, opposite: XYZ, top: XYZ): Box {
        const cmd = new Box();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: base, type: "input" }),
            pointStepResult({
                point: opposite,
                type: "input",
                plane: Plane.XY,
            }),
            pointStepResult({ point: top, type: "input" }),
        ]);
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build a BoxNode with dx/dy/dz derived from the three picked points", () => {
            // base at origin, opposite corner at (4,3), top point 5 above base along Z
            const cmd = boxWithThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 4, y: 3, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );

            const node = (cmd as any).geometryNode();

            expect(node).toBeInstanceOf(BoxNode);
            expect(node.dx).toBe(4);
            expect(node.dy).toBe(3);
            expect(node.dz).toBe(5);
            expect(node.plane.normal.isEqualTo(PLANE_XY.normal)).toBe(true);
        });

        test("should clamp a near-zero height to a tiny non-zero value", () => {
            const cmd = boxWithThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 2, z: 0 }),
                // point almost on the base plane (positive tiny height)
                new XYZ({ x: 0, y: 0, z: 1e-8 }),
            );

            const node = (cmd as any).geometryNode();
            // getHeight returns +0.00001 for positive-but-tiny heights
            expect(node.dz).toBeCloseTo(0.00001, 7);
        });

        test("should clamp a near-zero negative height to a tiny negative value", () => {
            const cmd = boxWithThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 2, z: 0 }),
                new XYZ({ x: 0, y: 0, z: -1e-8 }),
            );

            const node = (cmd as any).geometryNode();
            expect(node.dz).toBeCloseTo(-0.00001, 7);
        });
    });

    describe("getHeightStepData", () => {
        test("should expose preview and a Z-aligned direction for the height step", () => {
            const cmd = boxWithThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 4, y: 3, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );

            const data = (cmd as any).getHeightStepData();
            expect(typeof data.preview).toBe("function");
            expect(data.direction.isEqualTo(PLANE_XY.normal)).toBe(true);
            expect(data.point.isEqualTo(new XYZ({ x: 4, y: 3, z: 0 }))).toBe(true);
        });
    });

    describe("getHeight", () => {
        test("should return the signed projection of the top point onto the plane normal", () => {
            const cmd = boxWithThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 4, y: 3, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            const height = (cmd as any).getHeight(PLANE_XY, new XYZ({ x: 10, y: 10, z: 7 }));
            // only the Z component matters for an XY base plane
            expect(height).toBeCloseTo(7, 6);
        });
    });

    describe("previewBox", () => {
        test("should render base rect preview when end is undefined", () => {
            // disable dynamic workplane so rectDataFromTemp uses the static workplane
            const savedDynamic = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const cmd = boxWithThreePoints(
                    new XYZ({ x: 0, y: 0, z: 0 }),
                    new XYZ({ x: 4, y: 3, z: 0 }),
                    new XYZ({ x: 0, y: 0, z: 5 }),
                );
                const preview = (cmd as any).previewBox(undefined);
                // previewRect(point) returns [vertex, vertex, rect-mesh]
                expect(Array.isArray(preview)).toBe(true);
                expect(preview.length).toBe(3);
            } finally {
                Config.instance.dynamicWorkplane = savedDynamic;
            }
        });

        test("should render the full box preview when end is given", () => {
            const savedDynamic = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const cmd = boxWithThreePoints(
                    new XYZ({ x: 0, y: 0, z: 0 }),
                    new XYZ({ x: 4, y: 3, z: 0 }),
                    new XYZ({ x: 0, y: 0, z: 5 }),
                );
                const preview = (cmd as any).previewBox(new XYZ({ x: 0, y: 0, z: 5 }));
                // [meshPoint(p0), meshPoint(p1), meshCreatedShape("box",...)]
                expect(preview).toHaveLength(3);
            } finally {
                Config.instance.dynamicWorkplane = savedDynamic;
            }
        });
    });
});
