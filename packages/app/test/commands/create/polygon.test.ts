// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Polygon } from "../../../src/commands/create/polygon";

describe("Polygon", () => {
    test("should have command metadata", () => {
        const data = (Polygon as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.polygon");
        expect(data.icon).toBe("icon-toPoly");
    });

    test("should extend CreateFaceableCommand", () => {
        const cmd = new Polygon();
        expect(cmd.isFace).toBe(true);
    });

    test("confirm should be a function", () => {
        const cmd = new Polygon();
        expect(typeof cmd.confirm).toBe("function");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Polygon();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
