// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { GroupCommand } from "../../../src/commands/create/group";

describe("GroupCommand", () => {
    test("should have command metadata", () => {
        const data = (GroupCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.group");
        expect(data.icon).toBe("icon-group");
    });

    test("getSteps should return one step", () => {
        const cmd = new GroupCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});
