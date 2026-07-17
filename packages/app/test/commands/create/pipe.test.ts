// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IEdge,
    type IStep,
    type IView,
    Matrix4,
    Plane,
    type PointSnapData,
    PointStep,
    Result,
    type SnapResult,
    XYZ,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { Pipe } from "../../../src/commands/create/pipe";
import {
    ensureGlobalStubApp,
    seedStepDatas,
    stubTransactionRun,
    wireCommand,
} from "../../commands/commandTestUtils";

describe("Pipe", () => {
    test("should have command metadata", () => {
        const data = (Pipe as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.pipe");
        expect(data.icon).toBe("icon-pipe");
    });

    test("radius should default to 5", () => {
        const cmd = new Pipe();
        expect(cmd.radius).toBe(5);
    });

    test("radius setter should update property", () => {
        const cmd = new Pipe();
        cmd.radius = 10;
        expect(cmd.radius).toBe(10);
    });

    test("confirm should be a function", () => {
        const cmd = new Pipe();
        expect(typeof cmd.confirm).toBe("function");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Pipe();
        const steps = (cmd as any).getSteps() as IStep[];
        expect(steps.length).toBe(2);
        expect(steps[0]).toBeInstanceOf(PointStep);
        expect(steps[1]).toBeInstanceOf(PointStep);
    });

    describe("getNextData", () => {
        test("should return PointSnapData with refPoint and dimension", () => {
            const cmd = new Pipe();
            wireCommand(cmd);

            // Seed one point so refPoint works
            seedStepDatas(cmd, [
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "input",
                    point: new XYZ({ x: 0, y: 0, z: 0 }),
                } as SnapResult,
            ]);

            const data = (cmd as any).getNextData() as PointSnapData;
            expect(data.dimension).toBeDefined();
            expect(typeof data.preview).toBe("function");
            expect(typeof data.refPoint).toBe("function");
        });

        test("refPoint should throw when no last point exists", () => {
            const cmd = new Pipe();
            wireCommand(cmd);
            // No points seeded
            (cmd as any).stepDatas = [];

            const data = (cmd as any).getNextData() as PointSnapData;
            expect(() => data.refPoint!()).toThrow("Missing last point for snap reference");
        });

        test("should include featurePoints when first point exists and more than one point collected", () => {
            const cmd = new Pipe();
            wireCommand(cmd);

            const firstPoint = new XYZ({ x: 0, y: 0, z: 0 });
            seedStepDatas(cmd, [
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "input",
                    point: firstPoint,
                } as SnapResult,
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "input",
                    point: new XYZ({ x: 1, y: 0, z: 0 }),
                } as SnapResult,
            ]);

            const data = (cmd as any).getNextData() as PointSnapData;
            expect(data.featurePoints).toBeDefined();
            expect(data.featurePoints!.length).toBeGreaterThanOrEqual(1);
            expect(data.featurePoints![0].point).toBe(firstPoint);
        });

        test("should not include featurePoints when only one point exists", () => {
            const cmd = new Pipe();
            wireCommand(cmd);

            seedStepDatas(cmd, [
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "input",
                    point: new XYZ({ x: 0, y: 0, z: 0 }),
                } as SnapResult,
            ]);

            const data = (cmd as any).getNextData() as PointSnapData;
            expect(data.featurePoints).toBeUndefined();
        });
    });

    describe("preview", () => {
        test("should return mesh points for all valid points", () => {
            const cmd = new Pipe();
            wireCommand(cmd);

            seedStepDatas(cmd, [
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "input",
                    point: new XYZ({ x: 0, y: 0, z: 0 }),
                } as SnapResult,
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "input",
                    point: new XYZ({ x: 1, y: 0, z: 0 }),
                } as SnapResult,
            ]);

            const result = (cmd as any).preview(new XYZ({ x: 2, y: 0, z: 0 }));
            expect(Array.isArray(result)).toBe(true);
            // Should have 2 mesh points + 1 line (between existing points) + 1 line (to new point)
            expect(result.length).toBeGreaterThanOrEqual(3);
        });

        test("should return empty array when no valid points exist", () => {
            const cmd = new Pipe();
            wireCommand(cmd);
            (cmd as any).stepDatas = [];

            const result = (cmd as any).preview(undefined);
            expect(result).toEqual([]);
        });

        test("should handle single existing point with new hover point", () => {
            const cmd = new Pipe();
            wireCommand(cmd);

            seedStepDatas(cmd, [
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "input",
                    point: new XYZ({ x: 1, y: 2, z: 3 }),
                } as SnapResult,
            ]);

            const result = (cmd as any).preview(new XYZ({ x: 4, y: 5, z: 6 }));
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThanOrEqual(2); // 1 mesh point + 1 line
        });
    });

    describe("executeMainTask", () => {
        test("should return early when fewer than 2 points", () => {
            const cmd = new Pipe();
            const { addedNodes } = wireCommand(cmd);

            seedStepDatas(cmd, [
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "input",
                    point: new XYZ({ x: 0, y: 0, z: 0 }),
                } as SnapResult,
            ]);

            (cmd as any).executeMainTask();

            expect(addedNodes.length).toBe(0);
        });

        test("should return early when no points have valid values", () => {
            const cmd = new Pipe();
            const { addedNodes } = wireCommand(cmd);

            seedStepDatas(cmd, [
                {
                    view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as unknown as IView,
                    type: "input",
                    point: undefined,
                } as SnapResult,
            ]);

            (cmd as any).executeMainTask();

            expect(addedNodes.length).toBe(0);
        });
    });
});
