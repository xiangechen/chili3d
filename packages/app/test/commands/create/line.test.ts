// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { LineNode } from "../../../src/bodys";
import { Line } from "../../../src/commands/create/line";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("Line", () => {
    test("should have command metadata", () => {
        const data = (Line as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.line");
        expect(data.icon).toBe("icon-line");
    });

    test("isContinue should default to true", () => {
        const cmd = new Line();
        expect(cmd.isContinue).toBe(true);
    });

    test("isContinue setter should update property", () => {
        const cmd = new Line();
        cmd.isContinue = false;
        expect(cmd.isContinue).toBe(false);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Line();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    function lineWithPoints(start: XYZ, end: XYZ): Line {
        const cmd = new Line();
        wireCommand(cmd);
        seedStepDatas(cmd, [pointStepResult({ point: start }), pointStepResult({ point: end })]);
        return cmd;
    }

    describe("geometryNode", () => {
        test("should build a LineNode from two points", () => {
            const cmd = lineWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 5, z: 3 }));
            const node = (cmd as any).geometryNode();
            expect(node).toBeInstanceOf(LineNode);
            expect(node.start.isEqualTo(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(true);
            expect(node.end.isEqualTo(new XYZ({ x: 10, y: 5, z: 3 }))).toBe(true);
        });
    });

    describe("getSecondPointData", () => {
        test("should expose refPoint, dimension, validator, and preview", () => {
            const cmd = lineWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();
            expect(typeof data.refPoint).toBe("function");
            expect(typeof data.validator).toBe("function");
            expect(typeof data.preview).toBe("function");
        });

        test("refPoint should return the first step's point", () => {
            const cmd = lineWithPoints(new XYZ({ x: 2, y: 3, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();
            expect(data.refPoint().isEqualTo(new XYZ({ x: 2, y: 3, z: 0 }))).toBe(true);
        });

        test("validator should reject a coincident point", () => {
            const cmd = lineWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();
            expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should accept a distinct point", () => {
            const cmd = lineWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();
            expect(data.validator(new XYZ({ x: 5, y: 0, z: 0 }))).toBe(true);
        });
    });

    describe("linePreview", () => {
        test("should render only the first point when new point is undefined", () => {
            const cmd = lineWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const preview = (cmd as any).linePreview(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render first point and a line when new point is given", () => {
            const cmd = lineWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const preview = (cmd as any).linePreview(new XYZ({ x: 5, y: 0, z: 0 }));
            expect(preview).toHaveLength(2);
        });
    });

    describe("resetStepDatas", () => {
        test("should keep first step when isContinue is true", () => {
            const cmd = lineWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            cmd.isContinue = true;
            (cmd as any).resetStepDatas();
            expect((cmd as any).stepDatas).toHaveLength(1);
            // step 0 should now be the previous end point
            expect((cmd as any).stepDatas[0].point!.isEqualTo(new XYZ({ x: 10, y: 0, z: 0 }))).toBe(true);
        });

        test("should clear all step data when isContinue is false", () => {
            const cmd = lineWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            cmd.isContinue = false;
            (cmd as any).resetStepDatas();
            expect((cmd as any).stepDatas).toHaveLength(0);
        });
    });

    describe("executeMainTask", () => {
        test("should set repeatOperation to true via super call", () => {
            const cmd = lineWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            // Call the actual method - it delegates to super.executeMainTask and sets repeatOperation
            (cmd as any).executeMainTask();
            expect((cmd as any).repeatOperation).toBe(true);
        });
    });
});
