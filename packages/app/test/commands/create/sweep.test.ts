// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Sweep } from "../../../src/commands/create/sweep";

describe("Sweep", () => {
    test("should have command metadata", () => {
        const data = (Sweep as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.sweep");
        expect(data.icon).toBe("icon-sweep");
    });

    test("round should default to false", () => {
        const cmd = new Sweep();
        expect(cmd.round).toBe(false);
    });

    test("round setter should update property", () => {
        const cmd = new Sweep();
        cmd.round = true;
        expect(cmd.round).toBe(true);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Sweep();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
