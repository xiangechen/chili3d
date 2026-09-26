// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys, Property } from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";

// test-utils must load BEFORE the core-mock helper so the real core module is
// fully cached by the time `rs.mock("@chili3d/core")` registers.
import { createMockDocument, expectEmptyObjectsThrow } from "./_helpers/propertyTestHelpers";

// Shared mocks: CSS modules, element helpers, core services
import "./_helpers/cssMocks";
import "./_helpers/mockElement";
import "./_helpers/mockCoreProperty";

// Core value imports must come AFTER the mock helper — importing them earlier
// would load the real "@chili3d/core" before the mock registers.
import { Result } from "@chili3d/core";
import { InputProperty } from "../src/property/input";
import { mustQuery } from "./_helpers/domHelpers";

describe("InputProperty", () => {
    const valueProp: Property = { name: "value", display: "test.value" } as unknown as Property;
    const numberProp: Property = {
        name: "value",
        type: "number",
        display: "test.value",
    } as unknown as Property;

    describe("constructor basics", () => {
        test("should throw when objects array is empty", () => {
            expectEmptyObjectsThrow(() => new InputProperty(createMockDocument(), [], numberProp));
        });

        test("should create DOM structure with panel div", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            expect(prop.children.length).toBeGreaterThan(0);
            const panel = prop.querySelector('[class*="panel"]');
            expect(panel).not.toBeNull();
        });

        test("should contain an input element", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = prop.querySelector("input");
            expect(inputEl).not.toBeNull();
        });

        test("should contain a span for property name", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            const spans = prop.querySelectorAll("span");
            expect(spans.length).toBeGreaterThan(0);
        });

        test("should set PropertyBase className", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            expect(prop.className).toContain("panel");
        });

        test("should work with multiple objects", () => {
            const doc = createMockDocument();
            const objs = [{ value: 10 }, { value: 20 }];
            const prop = new InputProperty(doc, objs, valueProp);

            expect(prop.objects).toBe(objs);
            expect(prop.objects.length).toBe(2);
        });
    });

    describe("keydown and blur handling", () => {
        test("should have onkeydown handler on input", () => {
            const doc = createMockDocument();
            const obj = { value: "test" };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = mustQuery<HTMLInputElement>(prop, "input");
            expect((inputEl as any)._onkeydown).toBeDefined();
        });

        test("should not change readonly value on blur", () => {
            const doc = createMockDocument();
            const obj = { value: "test" };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = mustQuery<HTMLInputElement>(prop, "input");
            // plain object property without setter → readonly input
            expect(inputEl.readOnly).toBe(true);
            const blurHandler = (inputEl as any)._onblur as ((e: FocusEvent) => void) | undefined;
            expect(blurHandler).toBeDefined();

            inputEl.value = "changed";
            blurHandler!({ target: inputEl } as unknown as FocusEvent);

            // setValue returns early for readonly, so value unchanged
            expect(obj.value).toBe("test");
        });

        test("should not change readonly value on Enter key", () => {
            const doc = createMockDocument();
            const obj = { value: "readonly string" };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = mustQuery<HTMLInputElement>(prop, "input");
            const keyHandler = (inputEl as any)._onkeydown as ((e: KeyboardEvent) => void) | undefined;
            expect(keyHandler).toBeDefined();

            inputEl.value = "changed";
            keyHandler!(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            // setValue returns early for readonly, so value unchanged
            expect(obj.value).toBe("readonly string");
        });

        test("should stopPropagation on keydown when converter exists", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = mustQuery<HTMLInputElement>(prop, "input");
            const keyHandler = (inputEl as any)._onkeydown as ((e: KeyboardEvent) => void) | undefined;
            expect(keyHandler).toBeDefined();

            inputEl.value = "99";
            const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
            const stopSpy = rs.fn();
            event.stopPropagation = stopSpy;
            keyHandler!(event);

            expect(stopSpy).toHaveBeenCalled();
            // for plain objects isReadOnly is true, so value unchanged
            expect(obj.value).toBe(42);
        });

        test("should handle blur even for readonly values", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = mustQuery<HTMLInputElement>(prop, "input");
            const blurHandler = (inputEl as any)._onblur as ((e: FocusEvent) => void) | undefined;
            expect(blurHandler).toBeDefined();

            inputEl.value = "55";
            blurHandler!({ target: inputEl } as unknown as FocusEvent);

            // setValue returns early for readonly, so value unchanged
            expect(obj.value).toBe(42);
        });

        test("should stopPropagation on keydown for non-Enter keys", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = mustQuery<HTMLInputElement>(prop, "input");
            const keyHandler = (inputEl as any)._onkeydown as ((e: KeyboardEvent) => void) | undefined;
            expect(keyHandler).toBeDefined();

            const event = new KeyboardEvent("keydown", { key: "Tab" });
            const stopSpy = rs.fn();
            event.stopPropagation = stopSpy;
            keyHandler!(event);

            expect(stopSpy).toHaveBeenCalled();
        });
    });

    describe("empty input handling", () => {
        function writable(initial: unknown) {
            let stored = initial;
            const obj = {};
            Object.defineProperty(obj, "value", {
                get: () => stored,
                set: (v) => {
                    stored = v;
                },
            });
            return { obj, get: () => stored };
        }

        function blurWith(prop: InputProperty, value: string) {
            const inputEl = mustQuery<HTMLInputElement>(prop, "input");
            inputEl.value = value;
            const blurHandler = (inputEl as any)._onblur as ((e: FocusEvent) => void) | undefined;
            expect(blurHandler).toBeDefined();
            blurHandler!({ target: inputEl } as unknown as FocusEvent);
        }

        test("allows clearing a string property back to empty", () => {
            const doc = createMockDocument();
            const { obj, get } = writable("abc");
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = mustQuery<HTMLInputElement>(prop, "input");
            expect(inputEl.readOnly).toBe(false);

            blurWith(prop, "");
            expect(get()).toBe("");
        });

        test("accepts a non-empty edit for a string property", () => {
            const doc = createMockDocument();
            const { obj, get } = writable("abc");
            const prop = new InputProperty(doc, [obj], valueProp);

            blurWith(prop, "xyz");
            expect(get()).toBe("xyz");
        });

        test("refuses an empty edit for a number property", () => {
            const doc = createMockDocument();
            const { obj, get } = writable(42);
            const prop = new InputProperty(doc, [obj], valueProp);

            blurWith(prop, "");
            expect(get()).toBe(42);
        });

        test("blur without an edit keeps the differing values of a multi-selection", () => {
            const doc = createMockDocument();
            const a = writable("abc");
            const b = writable("xyz");
            const prop = new InputProperty(doc, [a.obj, b.obj], valueProp);

            // the mixed display reads ""; blurring it must not clear both objects
            blurWith(prop, "");
            expect(a.get()).toBe("abc");
            expect(b.get()).toBe("xyz");
        });

        test("blur without an edit writes nothing at all", () => {
            const doc = createMockDocument();
            let stored = "abc";
            let writes = 0;
            const obj = {};
            Object.defineProperty(obj, "value", {
                get: () => stored,
                set: (v) => {
                    writes++;
                    stored = v;
                },
            });
            const prop = new InputProperty(doc, [obj], valueProp);

            blurWith(prop, "abc");
            expect(writes).toBe(0);
            expect(stored).toBe("abc");
        });
    });

    describe("converter resolution", () => {
        test("should resolve Number converter for Number-typed values", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            expect(typeof prop.converter?.convert).toBe("function");
        });

        test("should resolve String converter for String-typed values", () => {
            const doc = createMockDocument();
            const obj = { value: "hello" };
            const prop = new InputProperty(doc, [obj], valueProp);

            expect(typeof prop.converter?.convert).toBe("function");
        });

        test("should resolve undefined for unknown types", () => {
            const doc = createMockDocument();
            class UnknownType {}
            const obj = { value: new UnknownType() };
            const prop = new InputProperty(doc, [obj], valueProp);

            expect(prop.converter).toBeUndefined();
        });

        test("should use custom converter from property definition", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const customConv = {
                convert: (v: unknown) => Result.ok(String(v)),
                convertBack: (v: string) => Result.ok(Number(v)),
            };
            const prop = new InputProperty(doc, [obj], {
                name: "value",
                display: "test.value" as I18nKeys,
                converter: customConv,
            });

            expect(prop.converter).toBe(customConv);
        });

        test("should use property.converter when provided over getConverter default", () => {
            const doc = createMockDocument();
            const obj = { value: 99 };
            const customConv = {
                convert: (v: unknown) => Result.ok(String(v)),
                convertBack: (v: string) => Result.ok(Number(v)),
            };
            const prop = new InputProperty(doc, [obj], {
                name: "value",
                display: "test.value" as I18nKeys,
                converter: customConv,
            });

            // Property-provided converter takes precedence
            expect(prop.converter).toBe(customConv);
            // It should NOT be the NumberConverter from getConverter
        });

        test("should throw when value is null", () => {
            const doc = createMockDocument();
            const obj = { value: null };
            expect(() => new InputProperty(doc, [obj], valueProp)).toThrow();
        });
    });
});

// Test ArrayValueConverter indirectly through InputProperty construction
describe("ArrayValueConverter (via InputProperty)", () => {
    test("should show single value when all objects have same value", () => {
        const doc = createMockDocument();
        const objs = [{ name: "same" }, { name: "same" }];
        const prop = new InputProperty(doc, objs, {
            name: "name",
            display: "test.name",
        } as unknown as Property);

        expect(prop.objects.length).toBe(2);
        expect(prop.querySelector("input")).not.toBeNull();
    });

    test("should construct property for objects with different values", () => {
        const doc = createMockDocument();
        const objs = [{ name: "a" }, { name: "b" }];
        const prop = new InputProperty(doc, objs, {
            name: "name",
            display: "test.name",
        } as unknown as Property);

        expect(prop.querySelector("input")).not.toBeNull();
    });

    test("should construct property for number values", () => {
        const doc = createMockDocument();
        const objs = [{ x: 10 }, { x: 20 }];
        const prop = new InputProperty(doc, objs, {
            name: "x",
            display: "test.x",
        } as unknown as Property);

        expect(prop.querySelector("input")).not.toBeNull();
    });

    test("should construct property for single object with numeric value", () => {
        const doc = createMockDocument();
        const obj = { count: 5 };
        const prop = new InputProperty(doc, [obj], {
            name: "count",
            display: "test.count",
        } as unknown as Property);

        expect(prop.querySelector("input")).not.toBeNull();
    });
});
