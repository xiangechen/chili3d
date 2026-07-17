// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Plane, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { CylinderNode } from "../../../src/bodys/cylinder";
import { Cylinder } from "../../../src/commands/create/cylinder";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Cylinder", () => {
    test("should have command metadata", () => {
        const data = (Cylinder as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.cylinder");
        expect(data.icon).toBe("icon-cylinder");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Cylinder();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    /**
     * Cylinder's second step records a Plane (the one the radius was measured in);
     * the third step picks the height along that plane's normal. We seed a base
     * XY plane so radius/height math is predictable.
     */
    function cylinderFromPoints(center: XYZ, radiusPick: XYZ, heightPick: XYZ): Cylinder {
        const cmd = new Cylinder();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: center }),
            pointStepResult({ point: radiusPick, plane: Plane.XY }),
            pointStepResult({ point: heightPick }),
        ]);
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build a CylinderNode with radius and height from the three picks", () => {
            const cmd = cylinderFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 3, y: 4, z: 0 }), // radius = 5 in the XY plane
                new XYZ({ x: 0, y: 0, z: 10 }), // height 10 along +Z
            );
            const node = (cmd as any).geometryNode();

            expect(node).toBeInstanceOf(CylinderNode);
            expect(node.radius).toBeCloseTo(5, 6);
            expect(node.dz).toBeCloseTo(10, 6);
            expect(node.center.isEqualTo(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(true);
        });

        test("should flip the normal and use absolute height when the pick is below the base", () => {
            const cmd = cylinderFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: -7 }), // height -7 -> flip normal to -Z, |dz|=7
            );
            const node = (cmd as any).geometryNode();

            expect(node.dz).toBeCloseTo(7, 6);
            expect(node.normal.isEqualTo(XYZ.unitNZ)).toBe(true);
        });
    });

    describe("getHeight", () => {
        test("should project the point onto the plane normal relative to the center", () => {
            const cmd = cylinderFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 4 }),
            );
            const height = (cmd as any).getHeight(Plane.XY, new XYZ({ x: 5, y: 5, z: 9 }));
            expect(height).toBeCloseTo(9, 6);
        });
    });

    describe("getRadiusData", () => {
        test("validator should reject a coincident point", () => {
            const center = new XYZ({ x: 0, y: 0, z: 0 });
            const cmd = cylinderFromPoints(
                center,
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
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
            const cmd = cylinderFromPoints(
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
            const cmd = cylinderFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            expect((cmd as any).circlePreview(undefined)).toHaveLength(1);
        });

        test("should render center, radius line and circle mesh when end is given", () => {
            const cmd = cylinderFromPoints(
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

    describe("getHeightStepData", () => {
        test("should expose a Z-aligned direction and a validator rejecting zero height", () => {
            const cmd = cylinderFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            const data = (cmd as any).getHeightStepData();
            expect(data.direction.isEqualTo(Plane.XY.normal)).toBe(true);
            // height 0 (point in the base plane) -> rejected
            expect(data.validator(new XYZ({ x: 9, y: 9, z: 0 }))).toBe(false);
            // non-zero height -> accepted
            expect(data.validator(new XYZ({ x: 0, y: 0, z: 4 }))).toBe(true);
        });
    });

    describe("previewCylinder", () => {
        test("should fall back to circlePreview when end is undefined", () => {
            const cmd = cylinderFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                // circlePreview(stepDatas[1].point) returns 3 meshes
                expect((cmd as any).previewCylinder(undefined)).toHaveLength(3);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("should render the cylinder preview mesh when end is given", () => {
            const cmd = cylinderFromPoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 2, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 5 }),
            );
            const preview = (cmd as any).previewCylinder(new XYZ({ x: 0, y: 0, z: 5 }));
            expect(preview).toHaveLength(2);
        });
    });
});
