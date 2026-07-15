// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Arc2Point } from "../../../src/commands/create/arc2point";

describe("Arc2Point", () => {
    test("should have command metadata", () => {
        const data = (Arc2Point as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.arc2point");
        expect(data.icon).toBe("icon-arc2point");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Arc2Point();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });
});
