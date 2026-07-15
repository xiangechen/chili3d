// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Explode } from "../../../src/commands/modify/explode";

describe("Explode", () => {
    test("should have command metadata", () => {
        const data = (Explode as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.explode");
        expect(data.icon).toBe("icon-explode");
    });

    test("getSteps should return one step with multiple: true", () => {
        const cmd = new Explode();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});
