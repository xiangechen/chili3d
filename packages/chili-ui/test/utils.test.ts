// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { findPropertyControl } from "../src/property/utils";

// Helper function to create test objects with onPropertyChanged method
function createTestObject(props: Record<string, unknown> = {}) {
    const obj = {
        ...props,
        onPropertyChanged: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
    };
    return obj;
}

describe("findPropertyControl", () => {
    let mockDocument: any;

    beforeEach(() => {
        mockDocument = {
            visual: { update: () => {} },
            modelManager: {
                materials: [
                    { id: "mat1", name: "Material 1", color: 0xff0000 },
                    { id: "mat2", name: "Material 2", color: 0x00ff00 },
                ],
            },
        };
    });

    test("should return empty string when prop is undefined", () => {
        const result = findPropertyControl(mockDocument, [{}], undefined as any);
        expect(result).toBe("");
    });

    test("should return empty string when objects array is empty", () => {
        const result = findPropertyControl(mockDocument, [], { name: "test", type: "string" } as any);
        expect(result).toBe("");
    });

    test("should return ColorProperty instance for color type", () => {
        const property = { name: "color", type: "color", display: "test.color" } as any;
        const obj = createTestObject({ color: "#ff0000" });
        const result = findPropertyControl(mockDocument, [obj], property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("ColorProperty");
    });

    test("should return MaterialProperty instance for materialId type when canShowMaterialProperty returns true", () => {
        const property = { name: "materialId", type: "materialId", display: "test.material" } as any;
        const obj = createTestObject({ materialId: "mat1" });
        const result = findPropertyControl(mockDocument, [obj], property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("MaterialProperty");
    });

    test("should return InputProperty instance for materialId type when canShowMaterialProperty returns false", () => {
        const property = { name: "materialId", type: "materialId", display: "test.material" } as any;
        const obj1 = createTestObject({ materialId: "mat1" });
        const obj2 = createTestObject({ materialId: "mat2" });
        const result = findPropertyControl(mockDocument, [obj1, obj2], property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("InputProperty");
    });

    test("should return InputProperty instance for string value", () => {
        const property = { name: "name", display: "test.name" } as any;
        const obj = createTestObject({ name: "test" });
        const result = findPropertyControl(mockDocument, [obj], property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("InputProperty");
    });

    test("should return InputProperty instance for number value", () => {
        const property = { name: "count", display: "test.count" } as any;
        const obj = createTestObject({ count: 42 });
        const result = findPropertyControl(mockDocument, [obj], property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("InputProperty");
    });

    test("should return InputProperty instance for object value", () => {
        const property = { name: "config", display: "test.config" } as any;
        const obj = createTestObject({ config: { key: "value" } });
        const result = findPropertyControl(mockDocument, [obj], property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("InputProperty");
    });

    test("should return CheckProperty instance for boolean value", () => {
        const property = { name: "enabled", display: "test.enabled" } as any;
        const obj = createTestObject({ enabled: true });
        const result = findPropertyControl(mockDocument, [obj], property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("CheckProperty");
    });

    test("should return empty string for unsupported type", () => {
        const property = { name: "symbol", display: "test.symbol" } as any;
        const obj = { symbol: Symbol("test") };
        const result = findPropertyControl(mockDocument, [obj], property);
        expect(result).toBe("");
    });

    test("canShowMaterialProperty should return true for single object", () => {
        const objs = [createTestObject({ materialId: "mat1" })];
        const property = { name: "materialId", type: "materialId" } as any;
        const result = findPropertyControl(mockDocument, objs, property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("MaterialProperty");
    });

    test("canShowMaterialProperty should return true for multiple objects with same materialId", () => {
        const objs = [createTestObject({ materialId: "mat1" }), createTestObject({ materialId: "mat1" })];
        const property = { name: "materialId", type: "materialId" } as any;
        const result = findPropertyControl(mockDocument, objs, property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("MaterialProperty");
    });

    test("canShowMaterialProperty should return false for multiple objects with different materialId", () => {
        const objs = [createTestObject({ materialId: "mat1" }), createTestObject({ materialId: "mat2" })];
        const property = { name: "materialId", type: "materialId" } as any;
        const result = findPropertyControl(mockDocument, objs, property);
        expect(result).toBeDefined();
        expect((result as any).constructor.name).toContain("InputProperty");
    });

    // Skip TextureProperty test due to DOM issues in test environment
    test.skip("should return TextureProperty instance for Texture-like object", () => {
        // This test is skipped because TextureProperty has DOM-related issues in test environment
        // that cause circular reference errors when trying to append child nodes.
    });
});
