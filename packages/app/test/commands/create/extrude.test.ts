// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { ExtrudeCommand } from "../../../src/commands/create/extrude";

describe("ExtrudeCommand", () => {
    test("should have command metadata", () => {
        const data = (ExtrudeCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.extrude");
        expect(data.icon).toBe("icon-prism");
    });

    test("getSteps should return two steps", () => {
        const cmd = new ExtrudeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
