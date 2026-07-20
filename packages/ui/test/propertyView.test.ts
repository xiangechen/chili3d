// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";

// ============================================================
// Mocks setup — must come before imports
// ============================================================

// CSS modules
rs.mock("../src/property/propertyView.module.css", () => ({
    root: "pv-root",
    panel: "pv-panel",
    header: "pv-header",
    properties: "pv-properties",
}));

rs.mock("../src/property/propertyBase.module.css", () => ({
    panel: "pb-panel",
}));

rs.mock("../src/property/common.module.css", () => ({
    panel: "cm-panel",
    propertyName: "cm-property-name",
}));

rs.mock("../src/property/input.module.css", () => ({
    box: "ip-box",
}));

// Element helpers
// biome-ignore lint/suspicious/noExplicitAny: test mock
rs.mock("@chili3d/element", () => {
    function createEl(tag: string, props: any, ...children: any[]): HTMLElement {
        const el = document.createElement(tag);
        if (props && typeof props === "object" && !(props instanceof Node)) {
            if (props.className) el.className = props.className;
            if (props.textContent && typeof props.textContent !== "object") {
                el.textContent = String(props.textContent);
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
        Expander: class extends HTMLElement {
            contenxtPanel: HTMLElement;
            constructor(_title: string) {
                super();
                this.contenxtPanel = document.createElement("div");
                this.appendChild(this.contenxtPanel);
            }
        },
    };
});

// Track PubSub subscriptions for verification
const pubSubSubscriptions = new Map<string, (...args: unknown[]) => unknown>();

// Mock core
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
            constructor(_v: unknown, _p?: string, _c?: unknown) {}
        },
        Transaction: { execute: (_d: unknown, _s: string, fn: () => void) => fn() },
        PubSub: {
            default: {
                sub: (topic: string, handler: (...args: unknown[]) => unknown) => {
                    pubSubSubscriptions.set(topic, handler);
                },
                pub: () => {},
            },
        },
        PropertyUtils: {
            getProperties: (_proto: unknown) => [
                { name: "name", display: "test.name", type: "string" },
                { name: "color", display: "test.color", type: "color" },
            ],
            getOwnProperties: (_proto: unknown) => [
                { name: "transform", display: "test.transform", type: "matrix" },
            ],
        },
        Node: class {},
        FolderNode: class {},
        GroupNode: class {},
        VisualNode: class {
            display() {
                return "VisualObject";
            }
        },
    };
});

// Mock property control helpers to return simple DOM elements
rs.mock("../src/property/complexPropertyUtils", () => ({
    propertyControl: () => {
        const el = document.createElement("div");
        el.className = "mock-property-control";
        el.textContent = "property";
        return el;
    },
}));

rs.mock("../src/property/matrixProperty", () => ({
    MatrixProperty: class extends HTMLElement {
        constructor(_doc: unknown, _geos: unknown, _cls: string) {
            super();
            this.textContent = "matrix";
        }
    },
}));

// Now import the module under test
import { PropertyView } from "../src/property/propertyView";

describe("PropertyView", () => {
    beforeEach(() => {
        pubSubSubscriptions.clear();
    });

    describe("constructor", () => {
        test("should create with header label", () => {
            const pv = new PropertyView({ className: "test-panel" });

            const labels = pv.querySelectorAll("label");
            // Should have at least the header label
            expect(pv.innerHTML).toBeTruthy();
        });

        test("should apply provided className and root style", () => {
            const pv = new PropertyView({ className: "test-panel" });

            expect(pv.className).toContain("test-panel");
            expect(pv.className).toContain("pv-root");
        });

        test("should subscribe to showProperties event", () => {
            const pv = new PropertyView({ className: "test-panel" });

            expect(pubSubSubscriptions.has("showProperties")).toBe(true);
        });

        test("should subscribe to activeViewChanged event", () => {
            const pv = new PropertyView({ className: "test-panel" });

            expect(pubSubSubscriptions.has("activeViewChanged")).toBe(true);
        });

        test("should create panel element", () => {
            const pv = new PropertyView({ className: "test-panel" });

            const panel = pv.querySelector('[class*="panel"]');
            expect(panel).not.toBeNull();
        });
    });

    describe("handleShowProperties", () => {
        test("should clear existing properties when called with empty nodes", () => {
            const pv = new PropertyView({ className: "test-panel" });
            const doc = {
                visual: { update: () => {} },
                selection: { getSelectedNodes: () => [] },
            } as any;

            // Call showProperties with empty array
            const handler = pubSubSubscriptions.get("showProperties")!;
            expect(() => handler(doc, [])).not.toThrow();
        });

        test("should handle single Node", () => {
            const pv = new PropertyView({ className: "test-panel" });
            const doc = {
                visual: { update: () => {} },
                selection: { getSelectedNodes: () => [] },
            } as any;

            class TestNode {
                name = "test";
                color = "#ff0000";
                display() {
                    return "TestNode";
                }
            }

            const handler = pubSubSubscriptions.get("showProperties")!;
            // This tests the path where nodes[0] is not FolderNode so it falls through
            // Since TestNode is not instanceof Node (it's not a real Node subclass),
            // addModel should be called but neither branch matches
            expect(() => handler(doc, [new TestNode()])).not.toThrow();
        });

        test("should handle empty nodes gracefully", () => {
            const pv = new PropertyView({ className: "test-panel" });
            const doc = {} as any;

            const handler = pubSubSubscriptions.get("showProperties")!;
            expect(() => handler(doc, [])).not.toThrow();
        });
    });

    describe("handleActiveViewChanged", () => {
        test("should handle undefined view without error", () => {
            const pv = new PropertyView({ className: "test-panel" });

            const handler = pubSubSubscriptions.get("activeViewChanged")!;
            expect(() => handler(undefined)).not.toThrow();
        });

        test("should call showProperties via handleActiveViewChanged with valid view", () => {
            const pv = new PropertyView({ className: "test-panel" });
            const mockNodes = [{ name: "node1" }];
            const mockDoc = {
                visual: { update: () => {} },
                selection: { getSelectedNodes: () => mockNodes },
            } as any;

            const handler = pubSubSubscriptions.get("activeViewChanged")!;
            // This will trigger handleShowProperties internally
            expect(() => handler({ document: mockDoc })).not.toThrow();
        });
    });

    describe("isAllElementsOfTypeFirstElement", () => {
        test("should return true for empty array", () => {
            const pv = new PropertyView({ className: "test-panel" });
            // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
            expect((pv as any).isAllElementsOfTypeFirstElement([])).toBe(true);
        });

        test("should return true for single element array", () => {
            const pv = new PropertyView({ className: "test-panel" });
            // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
            expect((pv as any).isAllElementsOfTypeFirstElement([{ name: "x" }])).toBe(true);
        });

        test("should return true when all elements have same constructor", () => {
            const pv = new PropertyView({ className: "test-panel" });
            class Same {}
            const arr = [new Same(), new Same(), new Same()];
            // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
            expect((pv as any).isAllElementsOfTypeFirstElement(arr)).toBe(true);
        });

        test("should return false when elements have different constructors", () => {
            const pv = new PropertyView({ className: "test-panel" });
            class A {}
            class B {}
            const arr = [new A(), new B()];
            // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
            expect((pv as any).isAllElementsOfTypeFirstElement(arr)).toBe(false);
        });

        test("should return false when first two items same but third different", () => {
            const pv = new PropertyView({ className: "test-panel" });
            class A {}
            class B {}
            const arr = [new A(), new A(), new B()];
            // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
            expect((pv as any).isAllElementsOfTypeFirstElement(arr)).toBe(false);
        });

        test("should return true for two identical items", () => {
            const pv = new PropertyView({ className: "test-panel" });
            class Same {}
            const arr = [new Same(), new Same()];
            // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
            expect((pv as any).isAllElementsOfTypeFirstElement(arr)).toBe(true);
        });
    });
});
