// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { LengthMeasure } from "../../../src/commands/measure/length";

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
});
