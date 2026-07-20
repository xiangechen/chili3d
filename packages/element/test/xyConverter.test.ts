// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XY } from "@chili3d/core";
import { XYConverter } from "../src/converters/xyzConverter";

describe("XYConverter", () => {
    let converter: XYConverter;

    beforeEach(() => {
        converter = new XYConverter();
    });

    describe("convert", () => {
        test("should convert XY to comma-separated string", () => {
            const result = converter.convert(new XY({ x: 10, y: 20 }));
            expect(result.isOk).toBe(true);
            expect(result.value).toBe("10,20");
        });

        test("should convert negative values", () => {
            const result = converter.convert(new XY({ x: -5, y: -10 }));
            expect(result.value).toBe("-5,-10");
        });

        test("should convert zero values", () => {
            const result = converter.convert(new XY({ x: 0, y: 0 }));
            expect(result.value).toBe("0,0");
        });

        test("should convert float values", () => {
            const result = converter.convert(new XY({ x: 1.5, y: 2.75 }));
            expect(result.value).toBe("1.5,2.75");
        });
    });

    describe("convertBack", () => {
        test("should convert comma-separated string to XY", () => {
            const result = converter.convertBack("3,4");
            expect(result.isOk).toBe(true);
            expect(result.value.x).toBe(3);
            expect(result.value.y).toBe(4);
        });

        test("should handle negative values", () => {
            const result = converter.convertBack("-1,-2");
            expect(result.isOk).toBe(true);
            expect(result.value.x).toBe(-1);
            expect(result.value.y).toBe(-2);
        });

        test("should return error for single value", () => {
            const result = converter.convertBack("5");
            expect(result.isOk).toBe(false);
        });

        test("should return error for three values", () => {
            const result = converter.convertBack("1,2,3");
            expect(result.isOk).toBe(false);
        });

        test("should return error for non-numeric string", () => {
            const result = converter.convertBack("a,b");
            expect(result.isOk).toBe(false);
        });

        test("should return error for empty string", () => {
            const result = converter.convertBack("");
            expect(result.isOk).toBe(false);
        });

        test("should handle values with spaces (Number trims whitespace)", () => {
            // Number(" 10 ") = 10 (trimmed), so this is valid XY
            const result = converter.convertBack(" 10 , 20 ");
            expect(result.isOk).toBe(true);
            expect(result.value.x).toBe(10);
            expect(result.value.y).toBe(20);
        });
    });
});
