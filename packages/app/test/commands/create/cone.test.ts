// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Cone } from "../../../src/commands/create/cone";

describe("Cone", () => {
    test("should have command metadata", () => {
        const data = (Cone as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.cone");
        expect(data.icon).toBe("icon-cone");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Cone();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });
});
