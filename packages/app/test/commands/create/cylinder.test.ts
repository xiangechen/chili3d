// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Cylinder } from "../../../src/commands/create/cylinder";

describe("Cylinder", () => {
    test("should have command metadata", () => {
        const data = (Cylinder as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.cylinder");
        expect(data.icon).toBe("icon-cylinder");
    });

    test("getSteps should return three steps", () => {
        const cmd = new Cylinder();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });
});
