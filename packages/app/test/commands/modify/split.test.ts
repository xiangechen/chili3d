// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Split } from "../../../src/commands/modify/split";

describe("Split", () => {
    test("should have command metadata", () => {
        const data = (Split as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.split");
        expect(data.icon).toBe("icon-split");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Split();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
