// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Cursor } from "../src/cursor";

describe("Cursor", () => {
    describe("get", () => {
        test("should return 'default' for 'default' cursor type", () => {
            expect(Cursor.get("default")).toBe("default");
        });

        test("should return draw URL for 'draw' cursor type", () => {
            const result = Cursor.get("draw");
            expect(result).toContain("url(");
            expect(result).toContain("default");
        });

        test("should return 'crosshair' for 'select.default' cursor type", () => {
            expect(Cursor.get("select.default")).toBe("crosshair");
        });
    });
});
