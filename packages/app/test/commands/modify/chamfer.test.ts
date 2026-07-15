// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { ChamferCommand } from "../../../src/commands/modify/chamfer";

describe("ChamferCommand", () => {
    test("should have command metadata", () => {
        const data = (ChamferCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.chamfer");
        expect(data.icon).toBe("icon-chamfer");
    });

    test("length should default to 10", () => {
        const cmd = new ChamferCommand();
        expect(cmd.length).toBe(10);
    });

    test("length setter should update property", () => {
        const cmd = new ChamferCommand();
        cmd.length = 20;
        expect(cmd.length).toBe(20);
    });

    test("getSteps should return two steps", () => {
        const cmd = new ChamferCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
