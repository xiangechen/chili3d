// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Texture } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { basicPropertyControl } from "../src/property/basicPropertyControl";
import { propertyControl } from "../src/property/complexPropertyUtils";

/**
 * Creates a test object with `onPropertyChanged` stub required by Binding.
 */
function createTestObj(props: Record<string, unknown> = {}) {
    return {
        ...props,
        onPropertyChanged: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
    };
}

describe("propertyControl", () => {
    const mockDocument = {
        visual: { update: () => {} },
        modelManager: {
            materials: [{ id: "mat1" }, { id: "mat2" }],
        },
    } as unknown as IDocument;

    describe("guard clauses", () => {
        test("should return empty string when prop is undefined", () => {
            const result = propertyControl(mockDocument, [createTestObj()], undefined as never);
            expect(result).toBe("");
        });

        test("should return empty string when objects array is empty", () => {
            const result = propertyControl(mockDocument, [], {
                name: "test",
                type: "string",
                display: "test.label",
            } as never);
            expect(result).toBe("");
        });
    });

    describe("Texture detection", () => {
        test("should return TextureProperty when value is a Texture instance", () => {
            const texture = new Texture({ document: mockDocument });
            const obj = createTestObj({ texture });
            const result = propertyControl(mockDocument, [obj], {
                name: "texture",
                display: "test.texture",
                // biome-ignore lint/suspicious/noExplicitAny: test mock property
            } as any) as any;

            expect(result).toBeDefined();
            expect(result.document).toBe(mockDocument);
            expect(result.texture).toBe(texture);
        });
    });
});

describe("basicPropertyControl", () => {
    const mockDocument = {
        visual: { update: () => {} },
        modelManager: {
            materials: [{ id: "mat1" }, { id: "mat2" }],
        },
    } as unknown as IDocument;

    describe("guard clauses", () => {
        test("should return empty string when prop is undefined", () => {
            const result = basicPropertyControl(mockDocument, [createTestObj()], undefined as never);
            expect(result).toBe("");
        });

        test("should return empty string when objects array is empty", () => {
            const result = basicPropertyControl(mockDocument, [], {
                name: "test",
                type: "string",
                display: "test.label",
                // biome-ignore lint/suspicious/noExplicitAny: test mock property
            } as any);
            expect(result).toBe("");
        });
    });

    describe("type-based dispatch", () => {
        test("should return ColorProperty for color type", () => {
            const obj = createTestObj({ color: "#ff0000" });
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, [obj], {
                name: "color",
                type: "color",
                display: "test.color",
            } as any) as any;
            expect(result).toBeDefined();
            expect(result.constructor.name).toContain("ColorProperty");
        });

        test("should return MaterialProperty for materialId type with single object", () => {
            const obj = createTestObj({ materialId: "mat1" });
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, [obj], {
                name: "materialId",
                type: "materialId",
                display: "test.material",
            } as any) as any;
            expect(result).toBeDefined();
            expect(result.constructor.name).toContain("MaterialProperty");
        });

        test("should return InputProperty when materialId values differ", () => {
            const obj1 = createTestObj({ materialId: "mat1" });
            const obj2 = createTestObj({ materialId: "mat2" });
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, [obj1, obj2], {
                name: "materialId",
                type: "materialId",
                display: "test.material",
            } as any) as any;
            expect(result).toBeDefined();
            expect(result.constructor.name).toContain("InputProperty");
        });

        test("should return InputProperty for string type values", () => {
            const obj = createTestObj({ name: "hello" });
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, [obj], {
                name: "name",
                display: "test.name",
            } as any) as any;
            expect(result).toBeDefined();
            expect(result.constructor.name).toContain("InputProperty");
        });

        test("should return InputProperty for number type values", () => {
            const obj = createTestObj({ count: 42 });
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, [obj], {
                name: "count",
                display: "test.count",
            } as any) as any;
            expect(result).toBeDefined();
            expect(result.constructor.name).toContain("InputProperty");
        });

        test("should return InputProperty for object type values", () => {
            const obj = createTestObj({ config: { key: "value" } });
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, [obj], {
                name: "config",
                display: "test.config",
            } as any) as any;
            expect(result).toBeDefined();
            expect(result.constructor.name).toContain("InputProperty");
        });

        test("should return CheckProperty for boolean type values", () => {
            const obj = createTestObj({ enabled: true });
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, [obj], {
                name: "enabled",
                display: "test.enabled",
            } as any) as any;
            expect(result).toBeDefined();
            expect(result.constructor.name).toContain("CheckProperty");
        });

        test("should return empty string for unsupported types", () => {
            const obj = createTestObj({ sym: Symbol("test") });
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, [obj], {
                name: "sym",
                display: "test.sym",
            } as any);
            expect(result).toBe("");
        });
    });

    describe("canShowMaterialProperty logic", () => {
        test("should show MaterialProperty for single object", () => {
            const obj = createTestObj({ materialId: "mat1" });
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, [obj], {
                name: "materialId",
                type: "materialId",
                display: "mat.label",
            } as any) as any;
            expect(result.constructor.name).toContain("MaterialProperty");
        });

        test("should show MaterialProperty for multiple objects with same materialId", () => {
            const objs = [createTestObj({ materialId: "mat1" }), createTestObj({ materialId: "mat1" })];
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, objs, {
                name: "materialId",
                type: "materialId",
                display: "mat.label",
            } as any) as any;
            expect(result.constructor.name).toContain("MaterialProperty");
        });

        test("should show InputProperty for multiple objects with different materialId", () => {
            const objs = [createTestObj({ materialId: "mat1" }), createTestObj({ materialId: "mat2" })];
            // biome-ignore lint/suspicious/noExplicitAny: test mock property
            const result = basicPropertyControl(mockDocument, objs, {
                name: "materialId",
                type: "materialId",
                display: "mat.label",
            } as any) as any;
            expect(result.constructor.name).toContain("InputProperty");
        });
    });
});
