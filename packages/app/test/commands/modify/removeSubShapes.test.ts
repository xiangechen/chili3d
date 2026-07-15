// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { RemoveSubShapesCommand } from "../../../src/commands/modify/removeSubShapes";

describe("RemoveSubShapesCommand", () => {
    test("should have command metadata", () => {
        const data = (RemoveSubShapesCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.removeShapes");
        expect(data.icon).toBe("icon-removeSubShape");
    });

    test("getSteps should return two steps", () => {
        const cmd = new RemoveSubShapesCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
