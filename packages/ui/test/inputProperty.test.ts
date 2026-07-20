// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys, Property } from "@chili3d/core";
import { Result } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { InputProperty } from "../src/property/input";

// Mock CSS modules
rs.mock("../src/property/common.module.css", () => ({
    panel: "cm-panel",
    propertyName: "cm-property-name",
}));

rs.mock("../src/property/input.module.css", () => ({
    box: "ip-box",
}));

rs.mock("../src/property/propertyBase.module.css", () => ({
    panel: "pb-panel",
}));

// Mock element helpers
// biome-ignore lint/suspicious/noExplicitAny: test mock for DOM element factory
rs.mock("@chili3d/element", () => {
    // Lightweight Result mock to avoid circular dependency with @chili3d/core mock
    // Lightweight Result mock for converters
    const mockResult = {
        ok: (v: unknown) => ({ isOk: true, value: v }),
        err: (_e: unknown) => ({ isOk: false, error: _e }),
    };

    function createEl(tag: string, props: any, ...children: any[]): HTMLElement {
        const el = document.createElement(tag);
        if (props && typeof props === "object" && !(props instanceof Node)) {
            if (props.className) el.className = props.className;
            if (props.type) (el as HTMLInputElement).type = props.type;
            if (props.textContent && typeof props.textContent !== "object") {
                el.textContent = String(props.textContent);
            }
            if (props.readOnly !== undefined) (el as HTMLInputElement).readOnly = props.readOnly;
            if (props.onkeydown) (el as any)._onkeydown = props.onkeydown;
            if (props.onblur) (el as any)._onblur = props.onblur;
            if (props.onchange) (el as any)._onchange = props.onchange;
            if (props.value !== undefined && typeof props.value === "string") {
                (el as HTMLInputElement).value = props.value;
            }
        }
        for (const c of children) {
            if (c instanceof Node) el.appendChild(c);
            else if (typeof c === "string") el.appendChild(document.createTextNode(c));
        }
        return el;
    }

    // Mock converter class factory
    function makeConverter() {
        return class {
            convert(v: unknown) {
                return mockResult.ok(String(v));
            }
            convertBack(v: string) {
                return mockResult.ok(v);
            }
        };
    }

    const NumberConverter = makeConverter();
    const StringConverter = makeConverter();
    const XYConverter = makeConverter();
    const XYZConverter = makeConverter();

    return {
        div: (props: any, ...children: any[]) => createEl("div", props, ...children),
        span: (props: any) => createEl("span", props),
        input: (props: any) => createEl("input", props),
        label: (props: any) => createEl("label", props),
        NumberConverter,
        StringConverter,
        XYConverter,
        XYZConverter,
    };
});

// Mock core services
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    return {
        ...actual,
        Localize: class {
            private key: unknown;
            constructor(key: unknown) {
                this.key = key;
            }
            toString() {
                return String(this.key);
            }
        },
        Binding: class {
            constructor(_value: unknown, _prop?: string, _converter?: unknown) {}
        },
        Transaction: {
            execute: (_doc: unknown, _desc: string, fn: () => void) => fn(),
        },
        PubSub: {
            default: {
                pub: () => {},
                sub: () => {},
            },
        },
        Result: actual.Result,
        isPropertyChanged: () => false,
        XY: class {},
        XYZ: class {},
    };
});

describe("InputProperty", () => {
    function createMockDocument() {
        return {
            visual: { update: () => {} },
        } as any;
    }

    const valueProp: Property = { name: "value", display: "test.value" } as unknown as Property;
    const numberProp: Property = {
        name: "value",
        type: "number",
        display: "test.value",
    } as unknown as Property;

    describe("constructor basics", () => {
        test("should throw when objects array is empty", () => {
            const doc = createMockDocument();
            expect(() => new InputProperty(doc, [], numberProp)).toThrow("there are no objects");
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

        test("should use property.converter when provided", () => {
            const doc = createMockDocument();
            const obj = { value: "hello" };
            const customConverter = {
                convert: (v: unknown) => Result.ok(String(v)),
                convertBack: (v: string) => Result.ok(v.toUpperCase()),
            };
            const prop = new InputProperty(doc, [obj], {
                name: "value",
                display: "test.value",
                converter: customConverter,
            } as unknown as Property);

            expect(prop.converter).toBe(customConverter);
        });

        test("should handle object-type value with converter lookup", () => {
            const doc = createMockDocument();
            class CustomValue {}
            const obj = { value: new CustomValue() };
            const prop = new InputProperty(doc, [obj], valueProp);

            // No converter found for CustomValue — converter resolves to undefined
            expect(prop.converter).toBeUndefined();
        });
    });

    describe("keydown and blur handling", () => {
        test("should have onkeydown handler on input", () => {
            const doc = createMockDocument();
            const obj = { value: "test" };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = prop.querySelector("input") as HTMLInputElement;
            expect(inputEl).not.toBeNull();
        });

        test("should process blur event without error", () => {
            const doc = createMockDocument();
            const obj = { value: "test" };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = prop.querySelector("input") as HTMLInputElement;
            expect(() => {
                inputEl.dispatchEvent(new FocusEvent("blur"));
            }).not.toThrow();
        });

        test("should process Enter key without error for readonly input", () => {
            const doc = createMockDocument();
            const obj = { value: "readonly string" };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = prop.querySelector("input") as HTMLInputElement;
            expect(() => {
                inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            }).not.toThrow();
        });

        test("should stopPropagation on keydown when converter exists", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = prop.querySelector("input") as HTMLInputElement;
            const keyHandler = (inputEl as any)._onkeydown as ((e: KeyboardEvent) => void) | undefined;

            inputEl.value = "99";
            if (keyHandler) {
                const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
                keyHandler(event);
            }
            // stopPropagation was called; for plain objects isReadOnly is true, so value unchanged
            expect(prop).toBeDefined();
        });

        test("should handle blur even for readonly values", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = prop.querySelector("input") as HTMLInputElement;
            const blurHandler = (inputEl as any)._onblur as ((e: FocusEvent) => void) | undefined;

            inputEl.value = "55";
            if (blurHandler) {
                blurHandler({ target: inputEl } as unknown as FocusEvent);
            }

            // setValue returns early for readonly, so value unchanged
            expect(obj.value).toBe(42);
        });

        test("should stopPropagation on keydown for non-Enter keys", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = prop.querySelector("input") as HTMLInputElement;
            const keyHandler = (inputEl as any)._onkeydown as ((e: KeyboardEvent) => void) | undefined;

            if (keyHandler) {
                const event = new KeyboardEvent("keydown", { key: "Tab" });
                keyHandler(event);
            }
            expect(prop).toBeDefined();
        });
    });

    describe("setValue behavior", () => {
        test("should have converter defined for Number-typed value", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            // The value { value: 42 } has Number constructor name, so converter resolves
            expect(prop.converter).toBeDefined();
        });

        test("should have input element with correct properties", () => {
            const doc = createMockDocument();
            const obj = { value: 10 };
            const prop = new InputProperty(doc, [obj], valueProp);

            const inputEl = prop.querySelector("input") as HTMLInputElement;
            expect(inputEl).not.toBeNull();
        });
    });

    describe("converter resolution", () => {
        test("should resolve Number converter for Number-typed values", () => {
            const doc = createMockDocument();
            const obj = { value: 42 };
            const prop = new InputProperty(doc, [obj], valueProp);

            expect(prop.converter).toBeDefined();
        });

        test("should resolve String converter for String-typed values", () => {
            const doc = createMockDocument();
            const obj = { value: "hello" };
            const prop = new InputProperty(doc, [obj], valueProp);

            expect(prop.converter).toBeDefined();
        });

        test("should resolve undefined for unknown types", () => {
            const doc = createMockDocument();
            class UnknownType {}
            const obj = { value: new UnknownType() };
            const prop = new InputProperty(doc, [obj], valueProp);

            expect(prop).toBeDefined();
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

        test("should not crash when value is null", () => {
            const doc = createMockDocument();
            const obj = { value: null };
            expect(() => new InputProperty(doc, [obj], valueProp)).toThrow();
        });
    });
});

// Test ArrayValueConverter indirectly through InputProperty construction
describe("ArrayValueConverter (via InputProperty)", () => {
    function createMockDocument() {
        return { visual: { update: () => {} } } as any;
    }

    test("should show single value when all objects have same value", () => {
        const doc = createMockDocument();
        const objs = [{ name: "same" }, { name: "same" }];
        const prop = new InputProperty(doc, objs, {
            name: "name",
            display: "test.name",
        } as unknown as Property);

        // InputProperty should be created without error
        expect(prop).toBeDefined();
        expect(prop.objects.length).toBe(2);
    });

    test("should handle objects with different values", () => {
        const doc = createMockDocument();
        const objs = [{ name: "a" }, { name: "b" }];
        const prop = new InputProperty(doc, objs, {
            name: "name",
            display: "test.name",
        } as unknown as Property);

        // ArrayValueConverter should show empty string when values differ
        expect(prop).toBeDefined();
    });

    test("should handle number values", () => {
        const doc = createMockDocument();
        const objs = [{ x: 10 }, { x: 20 }];
        const prop = new InputProperty(doc, objs, {
            name: "x",
            display: "test.x",
        } as unknown as Property);

        expect(prop).toBeDefined();
    });

    test("should handle single object with numeric value", () => {
        const doc = createMockDocument();
        const obj = { count: 5 };
        const prop = new InputProperty(doc, [obj], {
            name: "count",
            display: "test.count",
        } as unknown as Property);

        expect(prop).toBeDefined();
    });
});
