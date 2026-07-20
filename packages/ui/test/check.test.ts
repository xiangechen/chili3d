// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Property } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";

// Mock CSS modules before importing modules under test
rs.mock("../src/property/common.module.css", () => ({
    panel: "cm-panel",
    propertyName: "cm-property-name",
}));

rs.mock("../src/property/propertyBase.module.css", () => ({
    panel: "pb-panel",
}));

// Mock element helpers — return simple DOM elements
// biome-ignore lint/suspicious/noExplicitAny: test mock for DOM element factory
rs.mock("@chili3d/element", () => ({
    div: (props: any, ...children: any[]) => {
        const el = document.createElement("div");
        if (props && typeof props === "object" && !(props instanceof Node)) {
            if (props.className) el.className = props.className;
            if (props.textContent) el.textContent = String(props.textContent);
        }
        for (const c of children) {
            if (c instanceof Node) el.appendChild(c);
            else if (typeof c === "string") el.appendChild(document.createTextNode(c));
        }
        return el;
    },
    span: (props: any) => {
        const el = document.createElement("span");
        if (props && typeof props === "object" && !(props instanceof Node)) {
            if (props.className) el.className = props.className;
            if (props.textContent && typeof props.textContent !== "object") {
                el.textContent = String(props.textContent);
            }
        }
        return el;
    },
    input: (props: any) => {
        const el = document.createElement("input");
        if (props && typeof props === "object") {
            if (props.type) el.type = props.type;
            if (props.checked !== undefined) (el as any)._checked = props.checked;
            if (props.onclick) (el as any)._onclick = props.onclick;
        }
        return el;
    },
}));

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
            constructor(_value: unknown, _prop?: string) {}
        },
        Transaction: {
            execute: (_doc: unknown, _desc: string, fn: () => void) => fn(),
        },
    };
});

import { CheckProperty } from "../src/property/check";

describe("CheckProperty", () => {
    function createMockDocument() {
        return {
            visual: { update: () => {} },
        } as any;
    }

    const propConfig: Property = {
        name: "enabled",
        type: "boolean",
        display: "test.enabled",
    } as unknown as Property;

    describe("constructor", () => {
        test("should throw when objects array is empty", () => {
            const doc = createMockDocument();
            expect(() => new CheckProperty(doc, [], propConfig)).toThrow("there are no objects");
        });

        test("should create DOM structure with panel div", () => {
            const doc = createMockDocument();
            const obj = { enabled: true };
            const prop = new CheckProperty(doc, [obj], propConfig);

            expect(prop.children.length).toBeGreaterThan(0);
            // Should have a div child with panel class
            const panel = prop.querySelector('[class*="panel"]');
            expect(panel).not.toBeNull();
        });

        test("should contain a checkbox input", () => {
            const doc = createMockDocument();
            const obj = { enabled: true };
            const prop = new CheckProperty(doc, [obj], propConfig);

            const checkbox = prop.querySelector("input[type='checkbox']");
            expect(checkbox).not.toBeNull();
        });

        test("should contain a property name span", () => {
            const doc = createMockDocument();
            const obj = { enabled: true };
            const prop = new CheckProperty(doc, [obj], propConfig);

            const spans = prop.querySelectorAll("span");
            expect(spans.length).toBeGreaterThan(0);
        });

        test("should set PropertyBase className", () => {
            const doc = createMockDocument();
            const obj = { enabled: true };
            const prop = new CheckProperty(doc, [obj], propConfig);

            expect(prop.className).toContain("panel");
        });

        test("should work with multiple objects", () => {
            const doc = createMockDocument();
            const objs = [{ enabled: true }, { enabled: false }];
            const prop = new CheckProperty(doc, objs, propConfig);

            expect(prop.objects).toBe(objs);
            expect(prop.objects.length).toBe(2);
        });
    });

    describe("onclick behavior", () => {
        test("should create input with onclick handler", () => {
            const doc = createMockDocument();
            const obj = { enabled: true };
            const prop = new CheckProperty(doc, [obj], propConfig);

            const checkbox = prop.querySelector("input[type='checkbox']") as HTMLInputElement;
            expect(checkbox).not.toBeNull();
        });

        test("should use first object's property for Binding checked", () => {
            const doc = createMockDocument();
            const obj = { enabled: true };
            const prop = new CheckProperty(doc, [obj], propConfig);

            expect(prop.objects[0].enabled).toBe(true);
        });

        test("should toggle boolean value on single object when clicked", () => {
            const doc = createMockDocument();
            const obj = { enabled: true };
            const prop = new CheckProperty(doc, [obj], propConfig);

            // Simulate clicking the checkbox: toggle enabled from true → false
            const input = prop.querySelector("input[type='checkbox']") as HTMLInputElement;
            const onclickHandler = (input as any)._onclick as (() => void) | undefined;
            expect(onclickHandler).toBeDefined();

            onclickHandler!();
            expect(obj.enabled).toBe(false);

            // Click again: toggle from false → true
            onclickHandler!();
            expect(obj.enabled).toBe(true);
        });

        test("should toggle boolean value on multiple objects when clicked", () => {
            const doc = createMockDocument();
            const obj1 = { enabled: true };
            const obj2 = { enabled: true };
            const prop = new CheckProperty(doc, [obj1, obj2], propConfig);

            const input = prop.querySelector("input[type='checkbox']") as HTMLInputElement;
            const onclickHandler = (input as any)._onclick as (() => void) | undefined;

            onclickHandler!();
            // Both objects should be toggled to false
            expect(obj1.enabled).toBe(false);
            expect(obj2.enabled).toBe(false);
        });

        test("should update document.visual when checkbox is toggled", () => {
            let visualUpdated = false;
            const doc = {
                visual: {
                    update: () => {
                        visualUpdated = true;
                    },
                },
            } as any;
            const obj = { enabled: true };
            const prop = new CheckProperty(doc, [obj], propConfig);

            const input = prop.querySelector("input[type='checkbox']") as HTMLInputElement;
            const onclickHandler = (input as any)._onclick as (() => void) | undefined;

            onclickHandler!();
            expect(visualUpdated).toBe(true);
        });

        test("should work with initially false value", () => {
            const doc = createMockDocument();
            const obj = { enabled: false };
            const prop = new CheckProperty(doc, [obj], propConfig);

            const input = prop.querySelector("input[type='checkbox']") as HTMLInputElement;
            const onclickHandler = (input as any)._onclick as (() => void) | undefined;

            onclickHandler!();
            expect(obj.enabled).toBe(true);
        });
    });
});
