// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { ArrayCommand } from "../../../src/commands/modify/array";

describe("ArrayCommand", () => {
    test("should have command metadata", () => {
        const data = (ArrayCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.array");
        expect(data.icon).toBe("icon-array");
    });

    test("patternType should default to 'option.command.patternType.linear'", () => {
        const cmd = new ArrayCommand();
        expect(cmd.patternType).toBe("option.command.patternType.linear");
    });

    test("patternType setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.patternType = "option.command.patternType.circular";
        expect(cmd.patternType).toBe("option.command.patternType.circular");

        cmd.patternType = "option.command.patternType.curve";
        expect(cmd.patternType).toBe("option.command.patternType.curve");

        cmd.patternType = "option.command.patternType.rectangular";
        expect(cmd.patternType).toBe("option.command.patternType.rectangular");
    });

    test("count should default to 3", () => {
        const cmd = new ArrayCommand();
        expect(cmd.count).toBe(3);
    });

    test("count setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.count = 5;
        expect(cmd.count).toBe(5);

        cmd.count = 10;
        expect(cmd.count).toBe(10);
    });

    test("isGroup should default to true", () => {
        const cmd = new ArrayCommand();
        expect(cmd.isGroup).toBe(true);
    });

    test("isGroup setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.isGroup = false;
        expect(cmd.isGroup).toBe(false);
    });

    test("numberX should default to 3", () => {
        const cmd = new ArrayCommand();
        expect(cmd.numberX).toBe(3);
    });

    test("numberX setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.numberX = 4;
        expect(cmd.numberX).toBe(4);
    });

    test("numberY should default to 3", () => {
        const cmd = new ArrayCommand();
        expect(cmd.numberY).toBe(3);
    });

    test("numberY setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.numberY = 5;
        expect(cmd.numberY).toBe(5);
    });

    test("numberZ should default to 3", () => {
        const cmd = new ArrayCommand();
        expect(cmd.numberZ).toBe(3);
    });

    test("numberZ setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.numberZ = 6;
        expect(cmd.numberZ).toBe(6);
    });

    test("showCount should reflect patternType (true for non-rectangular)", () => {
        const cmd = new ArrayCommand();
        cmd.patternType = "option.command.patternType.linear";
        expect(cmd.showCount).toBe(true);

        cmd.patternType = "option.command.patternType.rectangular";
        expect(cmd.showCount).toBe(false);
    });

    test("showCount setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.showCount = false;
        expect(cmd.showCount).toBe(false);

        cmd.showCount = true;
        expect(cmd.showCount).toBe(true);
    });

    test("getSteps should return appropriate steps for each pattern type", () => {
        const cmd = new ArrayCommand();

        cmd.patternType = "option.command.patternType.linear";
        expect((cmd as any).getSteps().length).toBe(2);

        cmd.patternType = "option.command.patternType.circular";
        expect((cmd as any).getSteps().length).toBe(3);

        cmd.patternType = "option.command.patternType.curve";
        expect((cmd as any).getSteps().length).toBe(1);

        cmd.patternType = "option.command.patternType.rectangular";
        expect((cmd as any).getSteps().length).toBe(4);
    });
});
