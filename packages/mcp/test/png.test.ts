// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { encodePng } from "../src/render/png";

describe("encodePng", () => {
    test("writes a valid PNG signature, IHDR dimensions, and IEND", () => {
        const width = 3;
        const height = 2;
        const png = encodePng(width, height, new Uint8Array(width * height * 4).fill(128));

        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.readUInt32BE(16)).toBe(width); // IHDR width
        expect(png.readUInt32BE(20)).toBe(height); // IHDR height
        expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe("IEND");
    });
});
