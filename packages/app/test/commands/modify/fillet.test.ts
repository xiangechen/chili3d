// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { FilletCommand } from "../../../src/commands/modify/fillet";

describe("FilletCommand", () => {
    test("should have command metadata", () => {
        const data = (FilletCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.fillet");
        expect(data.icon).toBe("icon-fillet");
    });

    test("radius should default to 10", () => {
        const cmd = new FilletCommand();
        expect(cmd.radius).toBe(10);
    });

    test("radius setter should update property", () => {
        const cmd = new FilletCommand();
        cmd.radius = 20;
        expect(cmd.radius).toBe(20);
    });

    test("getSteps should return two steps", () => {
        const cmd = new FilletCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
