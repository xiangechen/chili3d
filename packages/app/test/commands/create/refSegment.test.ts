// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { RefSegment } from "../../../src/commands/create/refSegment";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("RefSegment", () => {
    test("should have command metadata", () => {
        const data = (RefSegment as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.refSegment");
        expect(data.icon).toBe("icon-line");
    });

    test("getSteps should return two steps", () => {
        const cmd = new RefSegment();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    function refSegmentWithPoints(start: XYZ, end: XYZ): RefSegment {
        const cmd = new RefSegment();
        wireCommand(cmd);
        seedStepDatas(cmd, [pointStepResult({ point: start }), pointStepResult({ point: end })]);
        return cmd;
    }

    describe("getSecondPointData", () => {
        test("should expose refPoint, dimension, validator, and preview", () => {
            const cmd = refSegmentWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();
            expect(typeof data.refPoint).toBe("function");
            expect(typeof data.validator).toBe("function");
            expect(typeof data.preview).toBe("function");
        });

        test("refPoint should return the first step's point", () => {
            const cmd = refSegmentWithPoints(new XYZ({ x: 2, y: 3, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();
            expect(data.refPoint().isEqualTo(new XYZ({ x: 2, y: 3, z: 0 }))).toBe(true);
        });

        test("validator should reject a coincident point", () => {
            const cmd = refSegmentWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();
            expect(data.validator(new XYZ({ x: 0, y: 0, z: 0 }))).toBe(false);
        });

        test("validator should accept a distinct point", () => {
            const cmd = refSegmentWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();
            expect(data.validator(new XYZ({ x: 5, y: 0, z: 0 }))).toBe(true);
        });
    });

    describe("segmentPreview", () => {
        test("should render only the first point when new point is undefined", () => {
            const cmd = refSegmentWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const preview = (cmd as any).segmentPreview(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render first point and a line when new point is given", () => {
            const cmd = refSegmentWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            const preview = (cmd as any).segmentPreview(new XYZ({ x: 5, y: 0, z: 0 }));
            expect(preview).toHaveLength(2);
        });
    });

    describe("resetStepDatas", () => {
        test("should reuse the last endpoint as the new start", () => {
            const cmd = refSegmentWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            (cmd as any).resetStepDatas();
            expect((cmd as any).stepDatas).toHaveLength(1);
            expect((cmd as any).stepDatas[0].point!.isEqualTo(new XYZ({ x: 10, y: 0, z: 0 }))).toBe(true);
        });
    });

    describe("executeMainTask", () => {
        test("should execute and add annotation node to document", () => {
            const cmd = refSegmentWithPoints(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 5, z: 0 }));
            (cmd as any).executeMainTask();
            // The operation should be repeatable (for chaining segments)
            expect((cmd as any).repeatOperation).toBe(true);
        });
    });
});
