// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Arc3Point } from "../../../src/commands/create/arc3point";

describe("Arc3Point", () => {
    test("should have command metadata", () => {
        const data = (Arc3Point as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.arc3point");
        expect(data.icon).toBe("icon-arc3point");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Arc3Point();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });
});
