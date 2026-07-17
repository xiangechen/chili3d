// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Plane, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { ConeNode } from "../../../src/bodys/cone";
import { Cone } from "../../../src/commands/create/cone";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Cone", () => {
    test("should have command metadata", () => {
        const data = (Cone as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.cone");
        expect(data.icon).toBe("icon-cone");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Cone();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    function coneFromPoints(center: XYZ, radiusPick: XYZ, heightPick: XYZ): Cone {
        const cmd = new Cone();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: center }),
            pointStepResult({ point: radiusPick, plane: Plane.XY }),
            pointStepResult({ point: heightPick }),
        ]);
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build a ConeNode with radius and height from the three picks", () => {
            const cmd = coneFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 3, y: 4, z: 0 }), // radius 5
                new XYZ({ x: 0, y: 0, z: 8 }), // height 8 along +Z
            );
            const node = (cmd as any).geometryNode();

            expect(node).toBeInstanceOf(ConeNode);
            expect(node.radius).toBeCloseTo(5, 6);
            expect(node.dz).toBeCloseTo(8, 6);
            expect(node.center.isEqualTo(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(true);
        });

        test("should flip the normal when the height pick is below the base", () => {
            const cmd = coneFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: -6 }),
            );
            const node = (cmd as any).geometryNode();

            expect(node.dz).toBeCloseTo(6, 6);
            expect(node.normal.isEqualTo(XYZ.unitNZ)).toBe(true);
        });
    });

    describe("getHeight", () => {
        test("should project the point onto the plane normal relative to the center", () => {
            const cmd = coneFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            const height = (cmd as any).getHeight(Plane.XY, new XYZ({ x: 7, y: 7, z: 9 }));
            expect(height).toBeCloseTo(9, 6);
        });
    });

    describe("getRadiusData", () => {
        test("validator should reject a coincident point", () => {
            const center = new XYZ({ x: 0, y: 0, z: 0 });
            const cmd = coneFromPoints(center, new XYZ({ x: 2, y: 0, z: 0 }), new XYZ({ x: 0, y: 0, z: 5 }));
            const data = (cmd as any).getRadiusData();

            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                expect(data.validator(center)).toBe(false);
                expect(data.validator(new XYZ({ x: 3, y: 0, z: 0 }))).toBe(true);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("validator should reject a pick parallel to the plane normal", () => {
            const cmd = coneFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            const data = (cmd as any).getRadiusData();

            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                expect(data.validator(new XYZ({ x: 0, y: 0, z: 5 }))).toBe(false);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });

    describe("circlePreview", () => {
        test("should render only the center vertex when end is undefined", () => {
            const cmd = coneFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            expect((cmd as any).circlePreview(undefined)).toHaveLength(1);
        });

        test("should render center, radius line and circle mesh when end is given", () => {
            const cmd = coneFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const preview = (cmd as any).circlePreview(new XYZ({ x: 3, y: 0, z: 0 }));
                expect(preview).toHaveLength(3);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });

    describe("previewCone", () => {
        test("should fall back to circlePreview when end is undefined", () => {
            const cmd = coneFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                // circlePreview(stepDatas[1].point) returns 3 meshes
                expect((cmd as any).previewCone(undefined)).toHaveLength(3);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("should render the cone preview meshes (apex + base circle + 4 slant edges) when end is given", () => {
            const cmd = coneFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            const preview = (cmd as any).previewCone(new XYZ({ x: 0, y: 0, z: 5 }));
            // apex meshPoint + base circle mesh + 4 slant line meshes
            expect(preview).toHaveLength(6);
        });
    });
});
