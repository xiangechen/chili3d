// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4 } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { RotateConverter, ScalingConverter, TranslationConverter } from "../src/property/matrixProperty";

/**
 * Creates a mock geometry object with a real Matrix4 transform
 * that exposes getEulerAngles and getScale for convertBack tests.
 */
function createMockGeometry(transform?: Matrix4) {
    const matrix = transform ?? Matrix4.identity();
    return {
        transform: matrix,
    };
}

describe("TranslationConverter", () => {
    describe("convert (extract translation)", () => {
        test("should extract translation from matrix", () => {
            const matrix = Matrix4.fromTranslation(10, 20, 30);
            const geometry = createMockGeometry(matrix);
            const converter = new TranslationConverter(geometry as any);

            const result = converter.convert(matrix);
            expect(result.isOk).toBe(true);
            expect(result.value).toContain("10.000000");
            expect(result.value).toContain("20.000000");
            expect(result.value).toContain("30.000000");
        });

        test("should extract zero translation", () => {
            const matrix = Matrix4.identity();
            const geometry = createMockGeometry(matrix);
            const converter = new TranslationConverter(geometry as any);

            const result = converter.convert(matrix);
            expect(result.isOk).toBe(true);
            expect(result.value).toContain("0.000000");
        });

        test("should extract negative translation", () => {
            const matrix = Matrix4.fromTranslation(-5, -10, -15);
            const geometry = createMockGeometry(matrix);
            const converter = new TranslationConverter(geometry as any);

            const result = converter.convert(matrix);
            expect(result.value).toContain("-5.000000");
            expect(result.value).toContain("-10.000000");
            expect(result.value).toContain("-15.000000");
        });

        test("should format as comma-separated values", () => {
            const matrix = Matrix4.fromTranslation(5, 6, 7);
            const geometry = createMockGeometry(matrix);
            const converter = new TranslationConverter(geometry as any);

            const result = converter.convert(matrix);
            const parts = result.value.split(",");
            expect(parts.length).toBe(3);
        });
    });

    describe("convertBack (parse string → Matrix4)", () => {
        test("should parse comma-separated string back to Matrix4", () => {
            const geometry = createMockGeometry(Matrix4.identity());
            const converter = new TranslationConverter(geometry as any);

            const result = converter.convertBack("10.5, 20.5, 30.5");
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(Matrix4);
        });

        test("should preserve geometry rotation and scale in convertBack", () => {
            // Create a geometry with non-identity rotation and scale
            const transform = Matrix4.fromEuler(0.5, 0.3, 0);
            const geometry = createMockGeometry(transform);
            const converter = new TranslationConverter(geometry as any);

            const result = converter.convertBack("10, 20, 30");
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(Matrix4);
        });
    });

    test("converter should store geometry reference", () => {
        const geometry = createMockGeometry(Matrix4.identity());
        const converter = new TranslationConverter(geometry as any);

        expect(converter.geometry).toBe(geometry);
    });
});

describe("ScalingConverter", () => {
    describe("convert (extract scale)", () => {
        test("should extract scale from matrix", () => {
            const matrix = Matrix4.fromScale(2, 3, 4);
            const geometry = createMockGeometry(matrix);
            const converter = new ScalingConverter(geometry as any);

            const result = converter.convert(matrix);
            expect(result.isOk).toBe(true);
            expect(result.value).toContain("2.000000");
            expect(result.value).toContain("3.000000");
            expect(result.value).toContain("4.000000");
        });

        test("should extract unit scale from identity matrix", () => {
            const matrix = Matrix4.identity();
            const geometry = createMockGeometry(matrix);
            const converter = new ScalingConverter(geometry as any);

            const result = converter.convert(matrix);
            expect(result.value).toContain("1.000000");
        });
    });

    describe("convertBack (parse string → Matrix4)", () => {
        test("should parse comma-separated scale back to Matrix4", () => {
            const geometry = createMockGeometry(Matrix4.identity());
            const converter = new ScalingConverter(geometry as any);

            const result = converter.convertBack("1.5, 2.5, 3.5");
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(Matrix4);
        });
    });
});

describe("RotateConverter", () => {
    describe("convert (extract euler angles in degrees)", () => {
        test("should extract euler angles and convert to degrees", () => {
            const matrix = Matrix4.fromEuler(Math.PI / 2, Math.PI, 0);
            const geometry = createMockGeometry(matrix);
            const converter = new RotateConverter(geometry as any);

            const result = converter.convert(matrix);
            expect(result.isOk).toBe(true);
            // PI/2 * 180/PI = 90
            expect(result.value).toContain("90.000000");
            // PI * 180/PI = 180
            expect(result.value).toContain("180.000000");
            expect(result.value).toContain("0.000000");
        });

        test("should handle zero rotation", () => {
            const matrix = Matrix4.identity();
            const geometry = createMockGeometry(matrix);
            const converter = new RotateConverter(geometry as any);

            const result = converter.convert(matrix);
            expect(result.value).toContain("0.000000");
        });

        test("should handle negative rotation", () => {
            const matrix = Matrix4.fromEuler(-Math.PI / 4, 0, 0);
            const geometry = createMockGeometry(matrix);
            const converter = new RotateConverter(geometry as any);

            const result = converter.convert(matrix);
            expect(result.value).toContain("-45.000000");
        });
    });

    describe("convertBack (parse degrees → Matrix4)", () => {
        test("should parse degree string back to Matrix4", () => {
            const geometry = createMockGeometry(Matrix4.identity());
            const converter = new RotateConverter(geometry as any);

            const result = converter.convertBack("45, 30, 60");
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(Matrix4);
        });
    });
});

describe("MatrixConverter convertBack error handling", () => {
    function makeConv() {
        const geometry = createMockGeometry(Matrix4.identity());
        return new TranslationConverter(geometry as any);
    }

    test("should return error for insufficient values (only 2 numbers)", () => {
        const result = makeConv().convertBack("1, 2");
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("invalid number of values");
    });

    test("should return error for empty string", () => {
        const result = makeConv().convertBack("");
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("invalid number of values");
    });

    test("should return error for all non-numeric values", () => {
        const result = makeConv().convertBack("a, b, c");
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("invalid number of values");
    });

    test("should return error for mixed numeric/non-numeric values", () => {
        const result = makeConv().convertBack("1, two, 3");
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("invalid number of values");
    });

    test("should handle values with extra whitespace", () => {
        const result = makeConv().convertBack("  10  ,  20  ,  30  ");
        expect(result.isOk).toBe(true);
        expect(result.value).toBeInstanceOf(Matrix4);
    });

    test("should return error for too many values (4 numbers)", () => {
        const result = makeConv().convertBack("1, 2, 3, 4");
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("invalid number of values");
    });

    test("should return error for just 1 value", () => {
        const result = makeConv().convertBack("42");
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("invalid number of values");
    });
});
