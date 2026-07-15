// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { AngleMeasure } from "../../../src/commands/measure/angle";

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
});
