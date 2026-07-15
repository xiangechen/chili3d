// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Sew } from "../../../src/commands/modify/sew";

describe("Sew", () => {
    test("should have command metadata", () => {
        const data = (Sew as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.sew");
        expect(data.icon).toBe("icon-sew");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Sew();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
