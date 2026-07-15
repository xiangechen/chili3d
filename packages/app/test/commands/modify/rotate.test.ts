// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Rotate } from "../../../src/commands/modify/rotate";

describe("Rotate", () => {
    test("should have command metadata", () => {
        const data = (Rotate as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.rotate");
        expect(data.icon).toBe("icon-rotate");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Rotate();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });
});
