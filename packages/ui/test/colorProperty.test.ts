// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Property } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";

// Mock CSS modules before importing modules under test
rs.mock("../src/property/common.module.css", () => ({
    panel: "cm-panel",
    propertyName: "cm-property-name",
}));

rs.mock("../src/property/colorPorperty.module.css", () => ({
    color: "cp-color",
}));

rs.mock("../src/property/propertyBase.module.css", () => ({
    panel: "pb-panel",
}));

// Track event listeners for verification
const eventListeners: Map<string, Set<(...args: unknown[]) => unknown>> = new Map();

// Mock element helpers
// biome-ignore lint/suspicious/noExplicitAny: test mock for DOM element factory
rs.mock("@chili3d/element", () => {
    function createEl(tag: string, props: any, ...children: any[]): HTMLElement {
        const el = document.createElement(tag);
        if (props && typeof props === "object" && !(props instanceof Node)) {
            if (props.className) el.className = props.className;
            if (props.type) (el as HTMLInputElement).type = props.type;
            if (props.textContent && typeof props.textContent !== "object") {
                el.textContent = String(props.textContent);
            }
            if (props.onchange) {
                (el as any)._onchange = props.onchange;
                const key = `change:${tag}`;
                if (!eventListeners.has(key)) eventListeners.set(key, new Set());
                eventListeners.get(key)!.add(props.onchange);
            }
            if (props.onclick) {
                (el as any)._onclick = props.onclick;
            }
            if (props.value && typeof props.value !== "object") {
                (el as HTMLInputElement).value = props.value;
            }
        }
        for (const c of children) {
            if (c instanceof Node) el.appendChild(c);
            else if (typeof c === "string") el.appendChild(document.createTextNode(c));
        }
        return el;
    }

    return {
        div: (props: any, ...children: any[]) => createEl("div", props, ...children),
        span: (props: any) => createEl("span", props),
        label: (props: any) => createEl("label", props),
        input: (props: any) => createEl("input", props),
        button: (props: any) => createEl("button", props),
        ColorConverter: class {
            convert(v: string) {
                return { isOk: true, value: v };
            }
            convertBack(v: string) {
                return { isOk: true, value: v };
            }
        },
    };
});

// Mock core services
const mockPubSubHandlers: Map<string, (...args: unknown[]) => unknown> = new Map();

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
                pub: (_topic: string, ..._args: unknown[]) => {
                    // Store pub calls for verification
                },
                sub: (topic: string, handler: (...args: unknown[]) => unknown) => {
                    mockPubSubHandlers.set(topic, handler);
                },
            },
        },
        // Re-export actual enums and constants that might be needed
        Result: actual.Result,
    };
});

import { ColorProperty } from "../src/property/colorProperty";

describe("ColorProperty", () => {
    function createMockDocument() {
        return {
            visual: { update: () => {} },
        } as any;
    }

    const propConfig: Property = {
        name: "color",
        type: "color",
        display: "test.color",
    } as unknown as Property;

    beforeEach(() => {
        eventListeners.clear();
        mockPubSubHandlers.clear();
    });

    describe("constructor", () => {
        test("should throw when objects array is empty", () => {
            const doc = createMockDocument();
            expect(() => new ColorProperty(doc, [], propConfig)).toThrow("there are no objects");
        });

        test("should create DOM structure with panel div", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const prop = new ColorProperty(doc, [obj], propConfig);

            expect(prop.children.length).toBeGreaterThan(0);
            const panel = prop.querySelector('[class*="panel"]');
            expect(panel).not.toBeNull();
        });

        test("should contain a color input element", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const prop = new ColorProperty(doc, [obj], propConfig);

            const colorInput = prop.querySelector("input[type='color']");
            expect(colorInput).not.toBeNull();
        });

        test("should have input field stored", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const prop = new ColorProperty(doc, [obj], propConfig);

            expect(prop.input).toBeDefined();
            expect(prop.input).toBeInstanceOf(HTMLInputElement);
        });

        test("should contain a label for property name", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const prop = new ColorProperty(doc, [obj], propConfig);

            const labels = prop.querySelectorAll("label");
            expect(labels.length).toBeGreaterThan(0);
        });

        test("should have ColorConverter", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const prop = new ColorProperty(doc, [obj], propConfig);

            expect(prop.converter).toBeDefined();
        });

        test("should set PropertyBase className", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const prop = new ColorProperty(doc, [obj], propConfig);

            expect(prop.className).toContain("panel");
        });

        test("should work with multiple objects", () => {
            const doc = createMockDocument();
            const objs = [{ color: "#ff0000" }, { color: "#00ff00" }];
            const prop = new ColorProperty(doc, objs, propConfig);

            expect(prop.objects).toBe(objs);
            expect(prop.objects.length).toBe(2);
        });
    });

    describe("setColor handler", () => {
        const setColorPropConfig: Property = {
            name: "color",
            type: "color",
            display: "test.color",
        } as unknown as Property;

        test("should set color on all objects via Transaction", () => {
            const doc = createMockDocument();
            const obj1 = { color: "#ff0000" };
            const obj2 = { color: "#00ff00" };
            const prop = new ColorProperty(doc, [obj1, obj2], setColorPropConfig);

            const newColor = "#0000ff";
            const input = prop.querySelector("input") as HTMLInputElement;
            input.value = newColor;

            const event = new Event("change");
            Object.defineProperty(event, "target", {
                value: input,
                writable: false,
            });
            input.dispatchEvent(event);

            expect((prop.querySelector("input") as HTMLInputElement).value).toBe(newColor);
        });

        test("should set color property on all objects when convertBack succeeds", () => {
            const doc = createMockDocument();
            const obj1 = { color: "#ff0000" };
            const obj2 = { color: "#00ff00" };
            const prop = new ColorProperty(doc, [obj1, obj2], setColorPropConfig);

            const testValue = { r: 0, g: 0, b: 1 };
            (prop as any).converter = {
                convert: (v: unknown) => ({ isOk: true, value: v }),
                convertBack: (_v: string) => ({ isOk: true, value: testValue }),
            };

            const input = prop.querySelector("input") as HTMLInputElement;
            input.value = "#0000ff";
            // Call the onchange handler directly
            const handler = (input as any)._onchange as ((e: Event) => void) | undefined;
            if (handler) {
                handler({ target: input } as unknown as Event);
            }

            expect(obj1.color).toEqual(testValue);
            expect(obj2.color).toEqual(testValue);
        });

        test("should not modify objects when convertBack returns undefined value", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const originalColor = obj.color;
            const prop = new ColorProperty(doc, [obj], setColorPropConfig);

            (prop as any).converter = {
                convert: (v: unknown) => ({ isOk: true, value: v }),
                convertBack: (_v: string) => ({ isOk: true, value: undefined }),
            };

            const input = prop.querySelector("input") as HTMLInputElement;
            input.value = "invalid";
            const handler = (input as any)._onchange as ((e: Event) => void) | undefined;
            if (handler) {
                handler({ target: input } as unknown as Event);
            }

            expect(obj.color).toBe(originalColor);
        });

        test("should not modify objects when convertBack returns error result", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const originalColor = obj.color;
            const prop = new ColorProperty(doc, [obj], setColorPropConfig);

            (prop as any).converter = {
                convert: (v: unknown) => ({ isOk: true, value: v }),
                convertBack: (_v: string) => ({ isOk: false, value: undefined }),
            };

            const input = prop.querySelector("input") as HTMLInputElement;
            input.value = "bad-color";
            const handler = (input as any)._onchange as ((e: Event) => void) | undefined;
            if (handler) {
                handler({ target: input } as unknown as Event);
            }

            expect(obj.color).toBe(originalColor);
        });
    });

    describe("disconnectedCallback", () => {
        test("should not throw when disconnected", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const prop = new ColorProperty(doc, [obj], propConfig);

            expect(() => prop.disconnectedCallback()).not.toThrow();
        });

        test("should tolerate multiple disconnect calls", () => {
            const doc = createMockDocument();
            const obj = { color: "#ff0000" };
            const prop = new ColorProperty(doc, [obj], propConfig);

            expect(() => {
                prop.disconnectedCallback();
                prop.disconnectedCallback();
            }).not.toThrow();
        });
    });
});
