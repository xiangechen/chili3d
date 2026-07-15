// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { LoftCommand } from "../../../src/commands/create/loft";

describe("LoftCommand", () => {
    test("should have command metadata", () => {
        const data = (LoftCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.loft");
        expect(data.icon).toBe("icon-loft");
    });

    test("isSolid should default to false", () => {
        const cmd = new LoftCommand();
        expect(cmd.isSolid).toBe(false);
    });

    test("isRuled should default to false", () => {
        const cmd = new LoftCommand();
        expect(cmd.isRuled).toBe(false);
    });

    test("confirm should be a function", () => {
        const cmd = new LoftCommand();
        expect(typeof cmd.confirm).toBe("function");
    });
});
