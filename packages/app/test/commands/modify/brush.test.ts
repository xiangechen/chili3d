// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { AddBrushCommand, ClearBrushCommand, RemoveBrushCommand } from "../../../src/commands/modify/brush";

describe("AddBrushCommand", () => {
    test("should have command metadata", () => {
        const data = (AddBrushCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.brushAdd");
        expect(data.icon).toBe("icon-addBrush");
    });

    test("getSteps should return one step", () => {
        const cmd = new AddBrushCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});

describe("RemoveBrushCommand", () => {
    test("should have command metadata", () => {
        const data = (RemoveBrushCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.brushRemove");
        expect(data.icon).toBe("icon-removeBrush");
    });

    test("getSteps should return one step", () => {
        const cmd = new RemoveBrushCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});

describe("ClearBrushCommand", () => {
    test("should have command metadata", () => {
        const data = (ClearBrushCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.brushClear");
        expect(data.icon).toBe("icon-clearBrush");
    });

    test("getSteps should return one step", () => {
        const cmd = new ClearBrushCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });
});
