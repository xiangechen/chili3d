// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Sphere } from "../../../src/commands/create/sphere";

describe("Sphere", () => {
    test("should have command metadata", () => {
        const data = (Sphere as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.sphere");
        expect(data.icon).toBe("icon-sphere");
    });

    test("getSteps should return two steps (center + radius)", () => {
        const cmd = new Sphere();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
