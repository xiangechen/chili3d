// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { ArcNode } from "../../../src/bodys/arc";
import { Arc2Point } from "../../../src/commands/create/arc2point";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Arc2Point", () => {
    test("should have command metadata", () => {
        const data = (Arc2Point as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.arc2point");
        expect(data.icon).toBe("icon-arc2point");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Arc2Point();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    function arc2Point(p1: XYZ, p2: XYZ, heightPick: XYZ): Arc2Point {
        const cmd = new Arc2Point();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: p1 }),
            pointStepResult({ point: p2 }),
            pointStepResult({ point: heightPick }),
        ]);
        return cmd;
    }

    describe("getEndPointData", () => {
        test("should expose refPoint, dimension, validator, and preview", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const data = (cmd as any).getEndPointData();
            expect(typeof data.refPoint).toBe("function");
            expect(typeof data.validator).toBe("function");
            expect(typeof data.preview).toBe("function");
        });

        test("validator should reject a coincident point", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const data = (cmd as any).getEndPointData();
            expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should accept a distinct point", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const data = (cmd as any).getEndPointData();
            expect(data.validator(new XYZ({ x: 5, y: 0, z: 0 }))).toBe(true);
        });
    });

    describe("getHeightData", () => {
        test("should expose point, preview, plane, and validator", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const data = (cmd as any).getHeightData();
            expect(typeof data.point).toBe("function");
            expect(typeof data.preview).toBe("function");
            expect(typeof data.plane).toBe("function");
            expect(typeof data.validator).toBe("function");
        });

        test("point getter should return the midpoint", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const data = (cmd as any).getHeightData();
            const midpoint = data.point();
            expect(midpoint.x).toBeCloseTo(5, 6);
            expect(midpoint.y).toBeCloseTo(0, 6);
            expect(midpoint.z).toBeCloseTo(0, 6);
        });

        test("validator should reject coincident midpoint", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const data = (cmd as any).getHeightData();
            expect(data.validator(new XYZ({ x: 5, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should accept a distinct point", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const data = (cmd as any).getHeightData();
            expect(data.validator(new XYZ({ x: 5, y: 5, z: 0 }))).toBe(true);
        });
    });

    describe("endPreview", () => {
        test("should render only the first point when end is undefined", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const preview = (cmd as any).endPreview(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render both points and a line when end is given", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const preview = (cmd as any).endPreview(new XYZ({ x: 10, y: 0, z: 0 }));
            expect(preview).toHaveLength(3);
        });
    });

    describe("heightPreview", () => {
        test("should render p1, p2, and line when heightPoint is undefined", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const preview = (cmd as any).heightPreview(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                undefined,
            );
            expect(preview).toHaveLength(3); // p1 point, p2 point, line
        });

        test("should render arc preview with a valid height point", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const saved = Config.instance.dynamicWorkplane;
            Config.instance.dynamicWorkplane = false;
            try {
                const preview = (cmd as any).heightPreview(
                    new XYZ({ x: 0, y: 0, z: 0 }),
                    new XYZ({ x: 10, y: 0, z: 0 }),
                    new XYZ({ x: 5, y: 3, z: 0 }),
                );
                // Should have: p1, p2, line(p1,p2), midpoint, heightPoint, line(midpoint,heightPoint), arc mesh
                expect(preview.length).toBeGreaterThanOrEqual(4);
            } finally {
                Config.instance.dynamicWorkplane = saved;
            }
        });
    });

    describe("getActualHeightPoint", () => {
        test("should return undefined when height point is at midpoint", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const result = (cmd as any).getActualHeightPoint(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }), // same as midpoint
            );
            expect(result).toBeUndefined();
        });

        test("should return data when height point is valid", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const result = (cmd as any).getActualHeightPoint(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            expect(result).toBeDefined();
            expect(result.heightPoint).toBeDefined();
            expect(result.midpoint).toBeDefined();
            expect(result.heightDirection).toBeDefined();
        });
    });

    describe("geometryNode", () => {
        test("should build an ArcNode from three points", () => {
            const cmd = arc2Point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            );
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(ArcNode);
            expect(node.normal).toBeDefined();
            expect(node.center).toBeDefined();
        });

        test("should handle input-type height point", () => {
            const cmd = new Arc2Point();
            wireCommand(cmd);
            seedStepDatas(cmd, [
                pointStepResult({ point: new XYZ({ x: 0, y: 0, z: 0 }) }),
                pointStepResult({ point: new XYZ({ x: 10, y: 0, z: 0 }) }),
                pointStepResult({
                    point: new XYZ({ x: 5, y: 3, z: 0 }),
                    type: "input",
                }),
            ]);
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(ArcNode);
            expect(node.normal).toBeDefined();
        });
    });
});
