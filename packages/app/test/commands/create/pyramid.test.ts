// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Pyramid } from "../../../src/commands/create/pyramid";

describe("Pyramid", () => {
    test("should have command metadata", () => {
        const data = (Pyramid as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.pyramid");
        expect(data.icon).toBe("icon-pyramid");
    });

    test("getSteps should return three steps (two from RectCommandBase + height)", () => {
        const cmd = new Pyramid();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });
});
