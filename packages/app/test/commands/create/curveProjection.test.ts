// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { CurveProjectionCommand } from "../../../src/commands/create/curveProjection";

describe("CurveProjectionCommand", () => {
    test("should have command metadata", () => {
        const data = (CurveProjectionCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("convert.curveProjection");
        expect(data.icon).toBe("icon-curveProject");
    });

    test("dir should default to '0,0,-1'", () => {
        const cmd = new CurveProjectionCommand();
        expect(cmd.dir).toBe("0,0,-1");
    });

    test("dir setter should update valid direction", () => {
        const cmd = new CurveProjectionCommand();
        cmd.dir = "1,0,0";
        expect(cmd.dir).toBe("1,0,0");
    });

    test("getSteps should return two steps", () => {
        const cmd = new CurveProjectionCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });
});
