// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BezierCommand } from "../../../src/commands/create/bezier";

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
});
