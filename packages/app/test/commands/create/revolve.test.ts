// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Revolve } from "../../../src/commands/create/revolve";

describe("Revolve", () => {
    test("should have command metadata", () => {
        const data = (Revolve as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.revol");
        expect(data.icon).toBe("icon-revolve");
    });

    test("angle should default to 360", () => {
        const cmd = new Revolve();
        expect(cmd.angle).toBe(360);
    });

    test("angle setter should update property", () => {
        const cmd = new Revolve();
        cmd.angle = 180;
        expect(cmd.angle).toBe(180);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Revolve();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
