// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, MultistepCommand, XYZ } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { Move } from "../../../src/commands/modify/move";

describe("TransformedCommand (via Move)", () => {
    test("isClone should default to false", () => {
        const cmd = new Move();
        expect(cmd.isClone).toBe(false);
    });

    test("isClone setter should update property", () => {
        const cmd = new Move();
        cmd.isClone = true;
        expect(cmd.isClone).toBe(true);
    });

    test("should extend MultistepCommand", () => {
        const cmd = new Move();
        expect(cmd instanceof MultistepCommand).toBe(true);
    });
});
