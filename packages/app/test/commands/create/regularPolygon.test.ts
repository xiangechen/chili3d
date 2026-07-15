// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { RegularPolygon } from "../../../src/commands/create/regularPolygon";

describe("RegularPolygon", () => {
    test("should have command metadata", () => {
        const data = (RegularPolygon as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.regularPolygon");
        expect(data.icon).toBe("icon-polygon");
    });

    test("should extend CreateFaceableCommand", () => {
        const cmd = new RegularPolygon();
        expect(cmd.isFace).toBe(true);
    });

    test("sides should default to 6", () => {
        const cmd = new RegularPolygon();
        expect(cmd.sides).toBe(6);
    });

    test("sides setter should update property for valid values", () => {
        const cmd = new RegularPolygon();
        cmd.sides = 8;
        expect(cmd.sides).toBe(8);
    });

    test("sides setter should reject values less than 3", () => {
        const cmd = new RegularPolygon();
        cmd.sides = 8;
        cmd.sides = 2;
        // Should keep previous valid value
        expect(cmd.sides).toBe(8);
    });

    test("getSteps should return two steps", () => {
        const cmd = new RegularPolygon();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
