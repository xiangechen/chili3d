// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { ArcNode } from "../../../src/bodys/arc";
import { Arc3Point } from "../../../src/commands/create/arc3point";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Arc3Point", () => {
    test("should have command metadata", () => {
        const data = (Arc3Point as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.arc3point");
        expect(data.icon).toBe("icon-arc3point");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Arc3Point();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    function arc3point(p1: XYZ, p2: XYZ, p3: XYZ): Arc3Point {
        const cmd = new Arc3Point();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: p1 }),
            pointStepResult({ point: p2 }),
            pointStepResult({ point: p3 }),
        ]);
        return cmd;
    }

    describe("getMidPointData", () => {
        test("should expose refPoint, dimension, validator, and preview", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const data = (cmd as any).getMidPointData();
            expect(typeof data.refPoint).toBe("function");
            expect(typeof data.validator).toBe("function");
            expect(typeof data.preview).toBe("function");
        });

        test("validator should reject coincident first point", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const data = (cmd as any).getMidPointData();
            expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should accept a distinct point", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const data = (cmd as any).getMidPointData();
            expect(data.validator(new XYZ({ x: 5, y: 3, z: 0 }))).toBe(true);
        });
    });

    describe("getEndPointData", () => {
        test("should expose validator and preview", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const data = (cmd as any).getEndPointData();
            expect(typeof data.validator).toBe("function");
            expect(typeof data.preview).toBe("function");
        });

        test("validator should reject a point coincident with p1", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const data = (cmd as any).getEndPointData();
            expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should reject a point coincident with p2", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const data = (cmd as any).getEndPointData();
            expect(data.validator(new XYZ({ x: 5, y: 3, z: 0 }))).toBe(false);
        });

        test("validator should reject a collinear point", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const data = (cmd as any).getEndPointData();
            expect(data.validator(new XYZ({ x: 2.5, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should accept a non-collinear distinct point", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const data = (cmd as any).getEndPointData();
            expect(data.validator(new XYZ({ x: 0, y: 5, z: 0 }))).toBe(true);
        });
    });

    describe("midPreview", () => {
        test("should render only the first point when point is undefined", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const preview = (cmd as any).midPreview(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render both points and a line when point is given", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const preview = (cmd as any).midPreview(new XYZ({ x: 5, y: 3, z: 0 }));
            expect(preview).toHaveLength(3);
        });
    });

    describe("arcPreview", () => {
        test("should render p1 and p2 when end is undefined", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const preview = (cmd as any).arcPreview(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                undefined,
            );
            expect(preview).toHaveLength(2);
        });

        test("should render arc mesh for a valid arc", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const preview = (cmd as any).arcPreview(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            expect(preview.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe("geometryNode", () => {
        test("should build an ArcNode from three non-collinear points", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(ArcNode);
            expect(node.normal).toBeDefined();
            expect(node.center).toBeDefined();
        });

        test("should produce an arc with a non-zero angle", () => {
            const cmd = arc3point(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 5, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            );
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(ArcNode);
            expect(Math.abs(node.angle)).toBeGreaterThan(0);
        });
    });
});
