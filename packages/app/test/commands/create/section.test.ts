// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Section } from "../../../src/commands/create/section";

describe("Section", () => {
    test("should have command metadata", () => {
        const data = (Section as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.section");
        expect(data.icon).toBe("icon-section");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Section();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
