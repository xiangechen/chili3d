// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { SimplifyShapeCommand } from "../../../src/commands/modify/simplify";

describe("SimplifyShapeCommand", () => {
    test("should have command metadata", () => {
        const data = (SimplifyShapeCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.simplifyShape");
        expect(data.icon).toBe("icon-simplify");
    });

    test("removeEdges should default to true", () => {
        const cmd = new SimplifyShapeCommand();
        expect(cmd.removeEdges).toBe(true);
    });

    test("removeEdges setter should update property", () => {
        const cmd = new SimplifyShapeCommand();
        cmd.removeEdges = false;
        expect(cmd.removeEdges).toBe(false);
    });

    test("removeFaces should default to true", () => {
        const cmd = new SimplifyShapeCommand();
        expect(cmd.removeFaces).toBe(true);
    });

    test("removeFaces setter should update property", () => {
        const cmd = new SimplifyShapeCommand();
        cmd.removeFaces = false;
        expect(cmd.removeFaces).toBe(false);
    });

    test("getSteps should return one step", () => {
        const cmd = new SimplifyShapeCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});
