// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Box } from "../../../src/commands/create/box";

describe("Box", () => {
    test("should have command metadata", () => {
        const data = (Box as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.box");
        expect(data.icon).toBe("icon-box");
    });

    test("getSteps should return three steps (two from RectCommandBase + height)", () => {
        const cmd = new Box();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });
});
