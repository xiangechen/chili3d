// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Plane, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { ArcNode } from "../../../src/bodys/arc";
import { Arc } from "../../../src/commands/create/arc";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Arc", () => {
    test("should have command metadata", () => {
        const data = (Arc as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.arc");
        expect(data.icon).toBe("icon-arc");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Arc();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    function arcFromThreePoints(center: XYZ, radiusPick: XYZ, anglePick: XYZ): Arc {
        const cmd = new Arc();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: center }),
            pointStepResult({ point: radiusPick, plane: Plane.XY }),
            pointStepResult({ point: anglePick }),
        ]);
        // Initialize _planeAngle (normally done by the AngleStep via getAngleData)
        (cmd as any).getAngleData();
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build an ArcNode from center, radius point, and angle point", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(ArcNode);
            expect(node.center.isEqualTo(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(true);
        });

        test("should use the plane from step data when provided", () => {
            const customPlane = new Plane({
                origin: new XYZ({ x: 0, y: 0, z: 0 }),
                normal: XYZ.unitZ,
                xvec: XYZ.unitX,
            });
            const cmd = new Arc();
            wireCommand(cmd);
            seedStepDatas(cmd, [
                pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 0 }) }),
                pointStepResult({
                    point: new XYZ({ x: 5, y: 0, z: 0 }),
                    plane: customPlane,
                }),
                pointStepResult({ point: new XYZ({ x: 0, y: 5, z: 0 }) }),
            ]);
            // must call getAngleData first to initialize _planeAngle
            (cmd as any).getAngleData();
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(ArcNode);
            expect(node.normal.isEqualTo(customPlane.normal)).toBe(true);
        });
    });

    describe("getRadiusData", () => {
        test("should expose point getter and preview function", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const data = (cmd as any).getRadiusData();
            expect(data.point()).not.toBeNull();
            expect(typeof data.preview).toBe("function");
            expect(typeof data.plane).toBe("function");
            expect(typeof data.validator).toBe("function");
        });

        test("validator should reject coincident point", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const data = (cmd as any).getRadiusData();
            // coincident with center → rejected
            expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should reject a point parallel to the plane normal", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const data = (cmd as any).getRadiusData();
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                // point directly above center along Z (parallel to XY plane normal) → rejected
                expect(data.validator(new XYZ({ x: 0, y: 0, z: 5 }))).toBe(false);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });

        test("validator should accept a valid coplanar point", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const data = (cmd as any).getRadiusData();
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                expect(data.validator(new XYZ({ x: 3, y: 0, z: 0 }))).toBe(true);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });

    describe("getAngleData", () => {
        test("should return dimension, preview, plane, and validators", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const data = (cmd as any).getAngleData();
            expect(typeof data.dimension).toBe("number");
            expect(typeof data.preview).toBe("function");
            expect(typeof data.plane).toBe("function");
            expect(Array.isArray(data.validators)).toBe(true);
            expect(data.validators).toHaveLength(1);
        });

        test("angleValidator should reject a point too close to center", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const data = (cmd as any).getAngleData();
            const validator = data.validators[0];
            // point very close to center → rejected
            expect(validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
        });

        test("angleValidator should reject a point parallel to plane normal", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const data = (cmd as any).getAngleData();
            const validator = data.validators[0];
            // point directly above center along Z → rejected
            expect(validator(new XYZ({ x: 0, y: 0, z: 10 }))).toBe(false);
        });

        test("angleValidator should accept a valid point", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const data = (cmd as any).getAngleData();
            const validator = data.validators[0];
            expect(validator(new XYZ({ x: 0, y: 5, z: 0 }))).toBe(true);
        });
    });

    describe("circlePreview", () => {
        test("should render only the center vertex when end is undefined", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const preview = (cmd as any).circlePreview(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render center, line and circle mesh when end is given", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
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

    describe("anglePreview", () => {
        test("should render points when given angle point", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            (cmd as any).getAngleData();
            const preview = (cmd as any).anglePreview(
                new XYZ({ x: 0, y: 5, z: 0 }),
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                [],
            );
            expect(Array.isArray(preview)).toBe(true);
            expect(preview.length).toBeGreaterThan(0);
        });

        test("should fall back to p1 when point is undefined", () => {
            const cmd = arcFromThreePoints(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            (cmd as any).getAngleData();
            const preview = (cmd as any).anglePreview(
                undefined,
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                [],
            );
            expect(Array.isArray(preview)).toBe(true);
        });
    });
});
