// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Pipe } from "../../../src/commands/create/pipe";

describe("Pipe", () => {
    test("should have command metadata", () => {
        const data = (Pipe as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.pipe");
        expect(data.icon).toBe("icon-pipe");
    });

    test("radius should default to 5", () => {
        const cmd = new Pipe();
        expect(cmd.radius).toBe(5);
    });

    test("radius setter should update property", () => {
        const cmd = new Pipe();
        cmd.radius = 10;
        expect(cmd.radius).toBe(10);
    });

    test("confirm should be a function", () => {
        const cmd = new Pipe();
        expect(typeof cmd.confirm).toBe("function");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Pipe();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
