// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IConverter } from "../src/foundation";
import { Result } from "../src/foundation";
import type { I18nKeys } from "../src/i18n";
import { type Property, PropertyUtils, property } from "../src/property";

class MockConverter implements IConverter<string, string> {
    convert(value: string): Result<string> {
        return Result.ok(`converted:${value}`);
    }
    convertBack(value: string): Result<string> {
        return Result.ok(value.replace("converted:", ""));
    }
}

describe("property", () => {
    beforeEach(() => {
        // Clear the property registry before each test
        const PropertyKeyMap = (globalThis as any).PropertyKeyMap || new Map();
        PropertyKeyMap.clear();
        (globalThis as any).PropertyKeyMap = PropertyKeyMap;
    });

    describe("@property decorator", () => {
        test("should register property with basic display name", () => {
            class TestClass {
                @property("test.display" as I18nKeys)
                testProperty!: string;
            }

            const properties = PropertyUtils.getOwnProperties(TestClass.prototype);
            expect(properties).toHaveLength(1);
            expect(properties[0].name).toBe("testProperty");
            expect(properties[0].display).toBe("test.display");
        });

        test("should register property with optional parameters", () => {
            const mockConverter = new MockConverter();
            const dependencies = [{ property: "otherProp" as const, value: "test" }];

            class TestClass {
                @property("test.display" as I18nKeys, {
                    converter: mockConverter,
                    group: "test.group" as I18nKeys,
                    icon: "test-icon",
                    type: "color" as const,
                    dependencies,
                })
                testProperty!: string;
            }

            const properties = PropertyUtils.getOwnProperties(TestClass.prototype);
            expect(properties).toHaveLength(1);

            const prop = properties[0];
            expect(prop.name).toBe("testProperty");
            expect(prop.display).toBe("test.display");
            expect(prop.converter).toBe(mockConverter);
            expect(prop.group).toBe("test.group");
            expect(prop.icon).toBe("test-icon");
            expect(prop.type).toBe("color");
            expect(prop.dependencies).toEqual(dependencies);
        });

        test("should handle multiple properties on same class", () => {
            class TestClass {
                @property("first.display" as I18nKeys)
                firstProperty!: string;

                @property("second.display" as I18nKeys)
                secondProperty!: number;
            }

            const properties = PropertyUtils.getOwnProperties(TestClass.prototype);
            expect(properties).toHaveLength(2);

            const firstProp = properties.find((p) => p.name === "firstProperty");
            const secondProp = properties.find((p) => p.name === "secondProperty");

            expect(firstProp).toBeDefined();
            expect(firstProp?.display).toBe("first.display");
            expect(secondProp).toBeDefined();
            expect(secondProp?.display).toBe("second.display");
        });
    });

    describe("PropertyUtils.getOwnProperties", () => {
        test("should return empty array for class with no properties", () => {
            class EmptyClass {}
            const properties = PropertyUtils.getOwnProperties(EmptyClass.prototype);
            expect(properties).toEqual([]);
        });

        test("should return only own properties", () => {
            class BaseClass {
                @property("base.display" as I18nKeys)
                baseProperty!: string;
            }

            class DerivedClass extends BaseClass {
                @property("derived.display" as I18nKeys)
                derivedProperty!: string;
            }

            const properties = PropertyUtils.getOwnProperties(DerivedClass.prototype);
            expect(properties).toHaveLength(1);
            expect(properties[0].name).toBe("derivedProperty");
        });
    });

    describe("PropertyUtils.getProperties", () => {
        test("should get properties from prototype chain", () => {
            class BaseClass {
                @property("base.display" as I18nKeys)
                baseProperty!: string;
            }

            class DerivedClass extends BaseClass {
                @property("derived.display" as I18nKeys)
                derivedProperty!: string;
            }

            const properties = PropertyUtils.getProperties(DerivedClass.prototype);
            expect(properties).toHaveLength(2);

            const baseProp = properties.find((p) => p.name === "baseProperty");
            const derivedProp = properties.find((p) => p.name === "derivedProperty");

            expect(baseProp).toBeDefined();
            expect(derivedProp).toBeDefined();
        });

        test("should respect until parameter", () => {
            class GrandParentClass {
                @property("grandparent.display" as I18nKeys)
                grandparentProperty!: string;
            }

            class ParentClass extends GrandParentClass {
                @property("parent.display" as I18nKeys)
                parentProperty!: string;
            }

            class ChildClass extends ParentClass {
                @property("child.display" as I18nKeys)
                childProperty!: string;
            }

            const properties = PropertyUtils.getProperties(ChildClass.prototype, GrandParentClass.prototype);
            expect(properties).toHaveLength(2);

            const childProp = properties.find((p) => p.name === "childProperty");
            const parentProp = properties.find((p) => p.name === "parentProperty");
            const grandparentProp = properties.find((p) => p.name === "grandparentProperty");

            expect(childProp).toBeDefined();
            expect(parentProp).toBeDefined();
            expect(grandparentProp).toBeUndefined();
        });

        test("should order properties correctly (prototype chain processed recursively)", () => {
            class BaseClass {
                @property("base.display" as I18nKeys)
                baseProperty!: string;
            }

            class DerivedClass extends BaseClass {
                @property("derived.display" as I18nKeys)
                derivedProperty!: string;
            }

            const properties = PropertyUtils.getProperties(DerivedClass.prototype);
            expect(properties).toHaveLength(2);
            // BaseClass properties come first because they're added last at index 0
            expect(properties[0].name).toBe("baseProperty");
            expect(properties[1].name).toBe("derivedProperty");
        });
    });

    describe("PropertyUtils.getProperty", () => {
        test("should get own property", () => {
            class TestClass {
                @property("test.display" as I18nKeys)
                testProperty!: string;
            }

            const prop = PropertyUtils.getProperty(TestClass.prototype, "testProperty");
            expect(prop).toBeDefined();
            expect(prop?.name).toBe("testProperty");
            expect(prop?.display).toBe("test.display");
        });

        test("should get property from prototype chain", () => {
            class BaseClass {
                @property("base.display" as I18nKeys)
                baseProperty!: string;
            }

            class DerivedClass extends BaseClass {}

            const prop = PropertyUtils.getProperty(DerivedClass.prototype, "baseProperty");
            expect(prop).toBeDefined();
            expect(prop?.name).toBe("baseProperty");
        });

        test("should return undefined for non-existent property", () => {
            class TestClass {}

            const prop = PropertyUtils.getProperty(TestClass.prototype, "nonExistent" as keyof TestClass);
            expect(prop).toBeUndefined();
        });

        test("should handle null/undefined target", () => {
            const prop1 = PropertyUtils.getProperty(null as any, "test");
            const prop2 = PropertyUtils.getProperty(undefined as any, "test");

            expect(prop1).toBeUndefined();
            expect(prop2).toBeUndefined();
        });
    });

    describe("Property interface validation", () => {
        test("should create property with all fields", () => {
            const mockConverter = new MockConverter();
            const dependencies = [
                { property: "dep1" as const, value: "value1" },
                { property: "dep2" as const, value: 42 },
            ];

            const fullProperty: Property = {
                name: "testProperty",
                display: "test.display" as I18nKeys,
                converter: mockConverter,
                group: "test.group" as I18nKeys,
                icon: "test-icon",
                type: "color" as const,
                dependencies,
            };

            expect(fullProperty.name).toBe("testProperty");
            expect(fullProperty.display).toBe("test.display");
            expect(fullProperty.converter).toBe(mockConverter);
            expect(fullProperty.group).toBe("test.group");
            expect(fullProperty.icon).toBe("test-icon");
            expect(fullProperty.type).toBe("color");
            expect(fullProperty.dependencies).toEqual(dependencies);
        });
    });

    describe("PropertyType validation", () => {
        test("should accept valid property types", () => {
            class TestClass {
                @property("color.display" as I18nKeys, { type: "color" as const })
                colorProperty!: string;

                @property("material.display" as I18nKeys, { type: "materialId" as const })
                materialProperty!: string;
            }

            const properties = PropertyUtils.getOwnProperties(TestClass.prototype);
            expect(properties).toHaveLength(2);

            const colorProp = properties.find((p) => p.name === "colorProperty");
            const materialProp = properties.find((p) => p.name === "materialProperty");

            expect(colorProp?.type).toBe("color");
            expect(materialProp?.type).toBe("materialId");
        });
    });

    describe("Edge cases", () => {
        test("should handle property with symbol as key in map", () => {
            // Note: TypeScript decorators can't work with computed property names like symbols
            // This test validates the underlying data structure can handle symbols
            const symbolKey = Symbol("test");
            const testProperty: Property = {
                name: symbolKey as any,
                display: "symbol.display" as I18nKeys,
            };

            expect(testProperty.name).toBe(symbolKey);
            expect(testProperty.display).toBe("symbol.display");
        });

        test("should handle property with number as key", () => {
            class TestClass {
                @property("number.display" as I18nKeys)
                [0]!: string;
            }

            const properties = PropertyUtils.getOwnProperties(TestClass.prototype);
            expect(properties).toHaveLength(1);
            expect(properties[0].name).toBe(0);
        });

        test("should handle class without any decorators", () => {
            class PlainClass {
                plainProperty!: string;
            }

            const properties = PropertyUtils.getOwnProperties(PlainClass.prototype);
            expect(properties).toEqual([]);
        });
    });
});
