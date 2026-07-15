// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Line } from "../../../src/commands/create/line";

describe("Line", () => {
    test("should have command metadata", () => {
        const data = (Line as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.line");
        expect(data.icon).toBe("icon-line");
    });

    test("isContinue should default to true", () => {
        const cmd = new Line();
        expect(cmd.isContinue).toBe(true);
    });

    test("isContinue setter should update property", () => {
        const cmd = new Line();
        cmd.isContinue = false;
        expect(cmd.isContinue).toBe(false);
    });

    test("getSteps should return two steps", () => {
        const cmd = new Line();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
