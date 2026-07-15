// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Circle } from "../../../src/commands/create/circle";

describe("Circle", () => {
    test("should have command metadata", () => {
        const data = (Circle as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.circle");
        expect(data.icon).toBe("icon-circle");
    });

    test("should extend CreateFaceableCommand", () => {
        const cmd = new Circle();
        expect(cmd.isFace).toBe(true);
    });

    test("getSteps should return two steps (center + radius)", () => {
        const cmd = new Circle();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    test("isFace setter should update property", () => {
        const cmd = new Circle();
        cmd.isFace = false;
        expect(cmd.isFace).toBe(false);
        cmd.isFace = true;
        expect(cmd.isFace).toBe(true);
    });
});
