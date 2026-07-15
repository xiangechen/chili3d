// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Mirror } from "../../../src/commands/modify/mirror";

describe("Mirror", () => {
    test("should have command metadata", () => {
        const data = (Mirror as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.mirror");
        expect(data.icon).toBe("icon-mirror");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Mirror();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
