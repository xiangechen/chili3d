// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { AngleMeasure } from "../../../src/commands/measure/angle";
import { ensureGlobalStubApp, pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("AngleMeasure", () => {
    test("should have command metadata", () => {
        const data = (AngleMeasure as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("measure.angle");
        expect(data.icon).toBe("icon-measureAngle");
    });

    test("getSteps should return three PointSteps", () => {
        const cmd = new AngleMeasure();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });

    function angleMeasure(origin: XYZ, p1: XYZ, p2?: XYZ): AngleMeasure {
        const cmd = new AngleMeasure();
        wireCommand(cmd);
        seedStepDatas(cmd, [
            pointStepResult({ point: origin }),
            pointStepResult({ point: p1 }),
            ...(p2 ? [pointStepResult({ point: p2 })] : []),
        ]);
        return cmd;
    }

    describe("getSecondPointData", () => {
        test("should reject coincident points", () => {
            const origin = new XYZ({ x: 0, y: 0, z: 0 });
            const cmd = angleMeasure(origin, new XYZ({ x: 1, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();

            expect(data.validator(origin)).toBe(false);
            expect(data.validator(new XYZ({ x: 5, y: 0, z: 0 }))).toBe(true);
        });
    });

    describe("getThirdPointData", () => {
        test("should reject points coincident with either previous point", () => {
            const origin = new XYZ({ x: 0, y: 0, z: 0 });
            const p1 = new XYZ({ x: 3, y: 0, z: 0 });
            const cmd = angleMeasure(origin, p1, new XYZ({ x: 0, y: 3, z: 0 }));
            const data = (cmd as any).getThirdPointData();

            expect(data.validator(origin)).toBe(false);
            expect(data.validator(p1)).toBe(false);
            expect(data.validator(new XYZ({ x: 1, y: 1, z: 0 }))).toBe(true);
        });
    });

    describe("arcInfo and anglePrompt", () => {
        test("should compute a 90° angle for perpendicular rays in the XY plane", () => {
            const cmd = angleMeasure(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 4, y: 0, z: 0 }), // first ray along +X
                new XYZ({ x: 0, y: 3, z: 0 }), // second ray along +Y
            );

            const info = (cmd as any).arcInfo(new XYZ({ x: 0, y: 3, z: 0 }));
            expect(info.rad).toBeCloseTo(Math.PI / 2, 5);
            // normal of the plane spanned by +X and +Y is +Z
            expect(info.normal.isEqualTo(new XYZ({ x: 0, y: 0, z: 1 }))).toBe(true);
        });

        test("anglePrompt should format radians as degrees with a ° suffix", () => {
            const cmd = angleMeasure(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 1, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 1, z: 0 }),
            );
            const prompt = (cmd as any).anglePrompt(new XYZ({ x: 0, y: 1, z: 0 }));
            expect(prompt).toBe("90.00°");
        });
    });

    describe("lineLength", () => {
        test("should return the first segment length when no third point", () => {
            const cmd = angleMeasure(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 3, y: 4, z: 0 }), // length 5
                new XYZ({ x: 0, y: 0, z: 0 }),
            );
            expect((cmd as any).lineLength(undefined)).toBeCloseTo(5, 6);
        });

        test("should return the minimum of the two segment lengths when a third point exists", () => {
            const cmd = angleMeasure(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 0, z: 0 }), // length 10
                new XYZ({ x: 0, y: 3, z: 0 }), // length 3
            );
            expect((cmd as any).lineLength(new XYZ({ x: 0, y: 3, z: 0 }))).toBeCloseTo(3, 6);
        });
    });

    describe("linePreview", () => {
        test("should render only the start vertex when end is undefined", () => {
            const cmd = angleMeasure(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            expect((cmd as any).linePreview(undefined)).toHaveLength(1);
        });

        test("should render start vertex + line when end is given", () => {
            const cmd = angleMeasure(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            expect((cmd as any).linePreview(new XYZ({ x: 3, y: 0, z: 0 }))).toHaveLength(2);
        });
    });

    describe("arcPreview", () => {
        test("should return the two-point meshes when end is undefined", () => {
            const cmd = angleMeasure(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            // [meshPoint(p0), meshPoint(p1), meshLine(p0,p1)]
            expect((cmd as any).arcPreview(undefined)).toHaveLength(3);
        });

        test("should render arc + second line when end is given and angle is non-trivial", () => {
            const cmd = angleMeasure(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            const preview = (cmd as any).arcPreview(new XYZ({ x: 0, y: 5, z: 0 }));
            // [line2, arc, meshPoint(p0), meshPoint(p1), meshLine(p0,p1)]
            expect(preview.length).toBeGreaterThanOrEqual(4);
        });

        test("should omit the arc when the angle is near-zero", () => {
            const cmd = angleMeasure(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 5, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 5, z: 0 }),
            );
            // third point nearly collinear with first ray -> tiny angle -> just base meshes
            const preview = (cmd as any).arcPreview(new XYZ({ x: 5, y: 0.000001, z: 0 }));
            expect(preview).toHaveLength(3);
        });
    });

    describe("executeMainTask", () => {
        test("should display the angle via htmlText and show the arc meshes", () => {
            const cmd = angleMeasure(
                new XYZ({ x: 0, y: 0, z: 0 }),
                new XYZ({ x: 4, y: 0, z: 0 }),
                new XYZ({ x: 0, y: 4, z: 0 }),
            );
            const htmlText = (cmd as any).application.activeView.htmlText;
            const displayMesh = cmd.document.visual.context.displayMesh;

            (cmd as any).executeMainTask();

            expect(displayMesh).toHaveBeenCalledTimes(1);
            expect(htmlText).toHaveBeenCalledTimes(1);
            // 90° angle
            expect(htmlText).toHaveBeenCalledWith("90.00°", expect.any(Object), expect.any(Object));
        });
    });
});
