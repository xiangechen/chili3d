// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Ellipse } from "../../../src/commands/create/ellipse";

describe("Ellipse", () => {
    test("should have command metadata", () => {
        const data = (Ellipse as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.ellipse");
        expect(data.icon).toBe("icon-ellipse");
    });

    test("should extend CreateFaceableCommand", () => {
        const cmd = new Ellipse();
        expect(cmd.isFace).toBe(true);
    });

    test("getSteps should return three steps", () => {
        const cmd = new Ellipse();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(3);
    });
});
