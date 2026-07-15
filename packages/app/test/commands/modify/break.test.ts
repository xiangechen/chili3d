// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Break } from "../../../src/commands/modify/break";

describe("Break", () => {
    test("should have command metadata", () => {
        const data = (Break as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.break");
        expect(data.icon).toBe("icon-break");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Break();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
