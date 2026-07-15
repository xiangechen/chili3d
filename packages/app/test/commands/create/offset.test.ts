// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { OffsetCommand } from "../../../src/commands/create/offset";

describe("OffsetCommand", () => {
    test("should have command metadata", () => {
        const data = (OffsetCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.offset");
        expect(data.icon).toBe("icon-offset");
    });

    test("joinType should default to 'option.command.joinType.arc'", () => {
        const cmd = new OffsetCommand();
        expect(cmd.joinType).toBe("option.command.joinType.arc");
    });

    test("joinType setter should update property", () => {
        const cmd = new OffsetCommand();
        cmd.joinType = "option.command.joinType.tangent";
        expect(cmd.joinType).toBe("option.command.joinType.tangent");
    });

    test("getSteps should return two steps", () => {
        const cmd = new OffsetCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
