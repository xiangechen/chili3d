// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { BezierCommand } from "../../../src/commands/create/bezier";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("BezierCommand", () => {
    test("should have command metadata", () => {
        const data = (BezierCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.bezier");
        expect(data.icon).toBe("icon-bezier");
    });

    test("getSteps should return two steps", () => {
        const cmd = new BezierCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    function bezierWithPoints(points: XYZ[]): BezierCommand {
        const cmd = new BezierCommand();
        wireCommand(cmd);
        seedStepDatas(
            cmd,
            points.map((p) => pointStepResult({ point: p })),
        );
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build an EditableShapeNode from the step data points", () => {
            const cmd = bezierWithPoints([
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            ]);
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(EditableShapeNode);
        });
    });

    describe("getNextData", () => {
        test("should expose refPoint, dimension, validator, preview, and featurePoints", () => {
            const cmd = bezierWithPoints([new XYZ({ x: 0, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            expect(typeof data.refPoint).toBe("function");
            expect(typeof data.validator).toBe("function");
            expect(typeof data.preview).toBe("function");
            expect(Array.isArray(data.featurePoints)).toBe(true);
        });

        test("refPoint should return the last step's point", () => {
            const cmd = bezierWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 3, y: 1, z: 0 })]);
            const data = (cmd as any).getNextData();
            const ref = data.refPoint();
            expect(ref.isEqualTo(new XYZ({ x: 3, y: 1, z: 0 }))).toBe(true);
        });

        test("featurePoints should include close point when more than 2 steps", () => {
            const cmd = bezierWithPoints([
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 3, y: 1, z: 0 }),
                new XYZ({ x: 5, y: 3, z: 0 }),
            ]);
            const data = (cmd as any).getNextData();
            expect(data.featurePoints).toHaveLength(1);
            expect(data.featurePoints[0].when()).toBe(true);
        });
    });

    describe("validator", () => {
        test("should reject a point coincident with any existing step data", () => {
            const cmd = bezierWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            // reject exact same point as step 0
            expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
            // reject exact same point as step 1
            expect(data.validator(new XYZ({ x: 5, y: 0, z: 0 }))).toBe(false);
        });

        test("should accept a distinct point", () => {
            const cmd = bezierWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            expect(data.validator(new XYZ({ x: 3, y: 3, z: 0 }))).toBe(true);
        });
    });

    describe("preview", () => {
        test("should render mesh points for all existing steps when no new point", () => {
            const cmd = bezierWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            const preview = data.preview(undefined);
            // At least 2 meshPoints + dash lines (previewLines) + bezier mesh
            expect(preview.length).toBeGreaterThan(0);
        });

        test("should render mesh points plus bezier shape with a new point", () => {
            const cmd = bezierWithPoints([new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 })]);
            const data = (cmd as any).getNextData();
            const preview = data.preview(new XYZ({ x: 3, y: 3, z: 0 }));
            expect(preview.length).toBeGreaterThan(0);
        });
    });

    describe("previewLines", () => {
        test("should return empty for fewer than 2 points", () => {
            const cmd = new BezierCommand();
            const lines = (cmd as any).previewLines([new XYZ({ x: 0, y: 0, z: 0 })]);
            expect(lines).toHaveLength(0);
        });

        test("should return dash line meshes between consecutive points", () => {
            const cmd = new BezierCommand();
            const points = [
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }),
            ];
            const lines = (cmd as any).previewLines(points);
            expect(lines).toHaveLength(2);
        });
    });
});
