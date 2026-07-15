// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { ThickSolidCommand } from "../../../src/commands/create/thickSolid";

describe("ThickSolidCommand", () => {
    test("should have command metadata", () => {
        const data = (ThickSolidCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.thickSolid");
        expect(data.icon).toBe("icon-thickSolid");
    });

    test("thickness should default to 10", () => {
        const cmd = new ThickSolidCommand();
        expect(cmd.thickness).toBe(10);
    });

    test("thickness setter should update property", () => {
        const cmd = new ThickSolidCommand();
        cmd.thickness = 20;
        expect(cmd.thickness).toBe(20);
    });

    test("getSteps should return one step", () => {
        const cmd = new ThickSolidCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});
