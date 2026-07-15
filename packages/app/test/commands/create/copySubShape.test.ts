// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { CopySubShapeCommand } from "../../../src/commands/create/copySubShape";

describe("CopySubShapeCommand", () => {
    test("should have command metadata", () => {
        const data = (CopySubShapeCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.copyShape");
        expect(data.icon).toBe("icon-subShape");
    });

    test("getSteps should return one step", () => {
        const cmd = new CopySubShapeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});
