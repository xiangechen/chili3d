// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Point } from "../../../src/commands/create/point";

describe("Point", () => {
    test("should have command metadata", () => {
        const data = (Point as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.point");
        expect(data.icon).toBe("icon-point");
    });

    test("getSteps should return one step", () => {
        const cmd = new Point();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});
