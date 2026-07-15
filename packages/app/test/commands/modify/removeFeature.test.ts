// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { RemoveFaceCommand } from "../../../src/commands/modify/removeFeature";

describe("RemoveFaceCommand", () => {
    test("should have command metadata", () => {
        const data = (RemoveFaceCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.removeFeature");
        expect(data.icon).toBe("icon-removeFeature");
    });

    test("getSteps should return two steps", () => {
        const cmd = new RemoveFaceCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
