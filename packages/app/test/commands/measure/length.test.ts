// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { LengthMeasure } from "../../../src/commands/measure/length";
import { pointStepResult, seedStepDatas, wireCommand } from "../commandTestUtils";

describe("LengthMeasure", () => {
    test("should have command metadata", () => {
        const data = (LengthMeasure as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("measure.length");
        expect(data.icon).toBe("icon-measureLength");
    });

    test("getSteps should return two PointSteps", () => {
        const cmd = new LengthMeasure();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    function lengthMeasure(p1: XYZ, p2: XYZ): LengthMeasure {
        const cmd = new LengthMeasure();
        wireCommand(cmd);
        seedStepDatas(cmd, [pointStepResult({ point: p1 }), pointStepResult({ point: p2 })]);
        return cmd;
    }

    describe("getSecondPointData", () => {
        test("should expose a validator rejecting coincident points and a preview", () => {
            const a = new XYZ({ x: 0, y: 0, z: 0 });
            const cmd = lengthMeasure(a, new XYZ({ x: 5, y: 0, z: 0 }));
            const data = (cmd as any).getSecondPointData();

            expect(typeof data.preview).toBe("function");
            expect(typeof data.validator).toBe("function");
            expect(data.validator(a)).toBe(false);
            expect(data.validator(new XYZ({ x: 1, y: 0, z: 0 }))).toBe(true);
        });
    });

    describe("executeMainTask", () => {
        test("should display the distance between the two picks via htmlText", () => {
            const cmd = lengthMeasure(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 3, y: 4, z: 0 }));

            const htmlText = (cmd as any).application.activeView.htmlText;
            const displayMesh = cmd.document.visual.context.displayMesh;

            (cmd as any).executeMainTask();

            expect(displayMesh).toHaveBeenCalledTimes(1);
            expect(htmlText).toHaveBeenCalledTimes(1);
            // distance 3-4-5 -> "5.00"
            expect(htmlText).toHaveBeenCalledWith("5.00", expect.any(Object), expect.any(Object));
        });
    });

    describe("linePreview", () => {
        test("should render only the start vertex when end is undefined", () => {
            const cmd = lengthMeasure(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const preview = (cmd as any).linePreview(undefined);
            expect(preview).toHaveLength(1);
        });

        test("should render start vertex + line when end is given", () => {
            const cmd = lengthMeasure(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 5, y: 0, z: 0 }));
            const preview = (cmd as any).linePreview(new XYZ({ x: 3, y: 4, z: 0 }));
            expect(preview).toHaveLength(2);
        });
    });
});
