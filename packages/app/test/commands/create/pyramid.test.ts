// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Plane, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { PyramidNode } from "../../../src/bodys/pyramid";
import { Pyramid } from "../../../src/commands/create/pyramid";
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

describe("Pyramid", () => {
    test("should have command metadata", () => {
        const data = (Pyramid as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.pyramid");
        expect(data.icon).toBe("icon-pyramid");
    });

    test("getSteps should return three steps (two from RectCommandBase + height)", () => {
        const cmd = new Pyramid();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    function pyramidFromPoints(base: XYZ, opposite: XYZ, apex: XYZ): Pyramid {
        const cmd = new Pyramid();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: base, type: "input" }),
            pointStepResult({ point: opposite, type: "input", plane: Plane.XY }),
            pointStepResult({ point: apex, type: "input" }),
        ]);
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build a PyramidNode with dx/dy/dz derived from the three picks", () => {
            const cmd = pyramidFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 4, y: 3, z: 0 }), // 4 x 3 base
                new XYZ({ x: 0, y: 0, z: 6 }), // height 6 along +Z
            );
            const node = (cmd as any).geometryNode();

            expect(node).toBeInstanceOf(PyramidNode);
            expect(node.dx).toBe(4);
            expect(node.dy).toBe(3);
            expect(node.dz).toBeCloseTo(6, 6);
            expect(node.plane.normal.isEqualTo(PLANE_XY.normal)).toBe(true);
        });
    });

    describe("getHeightStepData", () => {
        test("should expose a preview and Z-aligned direction with a centered point", () => {
            const cmd = pyramidFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 4, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );

            const data = (cmd as any).getHeightStepData();
            expect(typeof data.preview).toBe("function");
            expect(data.direction.isEqualTo(PLANE_XY.normal)).toBe(true);
            // point is the midpoint of the two base picks: (0+4)/2 = (2, 0, 0)
            expect(data.point.isEqualTo(new XYZ({ x: 2, y: 0, z: 0 }))).toBe(true);
        });
    });

    describe("previewPyramid", () => {
        test("should render base rect preview when end is undefined", () => {
            const savedDynamic = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const cmd = pyramidFromPoints(
                    new XYZ({ x: 0, y: 0, z: 0 }),
                    new XYZ({ x: 4, y: 0, z: 0 }),
                    new XYZ({ x: 0, y: 0, z: 5 }),
                );
                const preview = (cmd as any).previewPyramid(undefined);
                // previewRect(point) returns [vertex, vertex, rect-mesh]
                expect(preview).toHaveLength(3);
            } finally {
                Config.instance.dynamicWorkplane = savedDynamic;
            }
        });

        test("should render the full pyramid preview when end is given", () => {
            const savedDynamic = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const cmd = pyramidFromPoints(
                    new XYZ({ x: 0, y: 0, z: 0 }),
                    new XYZ({ x: 4, y: 3, z: 0 }),
                    new XYZ({ x: 0, y: 0, z: 5 }),
                );
                const preview = (cmd as any).previewPyramid(new XYZ({ x: 0, y: 0, z: 5 }));
                // [meshPoint(p0), meshPoint(p1), meshCreatedShape("pyramid",...)]
                expect(preview).toHaveLength(3);
            } finally {
                Config.instance.dynamicWorkplane = savedDynamic;
            }
        });
    });
});
