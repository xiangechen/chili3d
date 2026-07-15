// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Move } from "../../../src/commands/modify/move";

describe("Move", () => {
    test("should have command metadata", () => {
        const data = (Move as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.move");
        expect(data.icon).toBe("icon-move");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Move();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
