// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { RepairShapeCommand } from "../../../src/commands/modify/repair";

describe("RepairShapeCommand", () => {
    test("should have command metadata", () => {
        const data = (RepairShapeCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.repairShape");
        expect(data.icon).toBe("icon-repair");
    });

    test("tolerance should default to 1e-5", () => {
        const cmd = new RepairShapeCommand();
        expect(cmd.tolerance).toBe(1e-5);
    });

    test("tolerance setter should update property", () => {
        const cmd = new RepairShapeCommand();
        cmd.tolerance = 1e-4;
        expect(cmd.tolerance).toBe(1e-4);
    });

    test("getSteps should return one step", () => {
        const cmd = new RepairShapeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});
