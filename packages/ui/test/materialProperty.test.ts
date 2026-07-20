// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Material, Property } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";

// Mock CSS modules
rs.mock("../src/property/materialProperty.module.css", () => ({
    material: "mp-material",
}));

rs.mock("../src/property/propertyBase.module.css", () => ({
    panel: "pb-panel",
}));

// Mock element helpers
rs.mock("@chili3d/element", () => {
    function createEl(tag: string, props: any, ...children: any[]): HTMLElement {
        const el = document.createElement(tag);
        if (props && typeof props === "object" && !(props instanceof Node)) {
            if (props.className) el.className = props.className;
            if (props.textContent !== undefined && typeof props.textContent === "string") {
                el.textContent = props.textContent;
            }
            if (props.onclick) (el as any)._onclick = props.onclick;
            if (props.style) Object.assign(el.style, props.style);
            if (props.type) (el as HTMLInputElement).type = props.type;
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
        button: (props: any) => createEl("button", props),
        collection: (opts: any) => {
            const container = document.createElement("div");
            if (opts && opts.sources && opts.template) {
                const items: any[] = [];
                if (typeof opts.sources.forEach === "function") {
                    opts.sources.forEach((item: any) => items.push(item));
                } else if (Array.isArray(opts.sources)) {
                    items.push(...opts.sources);
                }
                for (let i = 0; i < items.length; i++) {
                    const el = opts.template(items[i], i);
                    if (el instanceof Node) container.appendChild(el);
                }
            }
            return container;
        },
        ColorConverter: class {},
        UrlStringConverter: class {},
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
        PathBinding: class {
            constructor(_value: unknown, _prop?: string, _converter?: unknown) {}
        },
        Transaction: {
            execute: (_doc: unknown, _desc: string, fn: () => void) => fn(),
        },
        ObservableCollection: class {
            private items: any[];
            constructor(...items: any[]) {
                this.items = items;
            }
            get length() {
                return this.items.length;
            }
            replace(index: number, item: any) {
                this.items[index] = item;
            }
            find(_fn: (m: any) => boolean) {
                return this.items.find(_fn);
            }
            forEach(fn: (m: any) => void) {
                this.items.forEach(fn);
            }
        },
        PubSub: {
            default: {
                pub: () => {},
                sub: () => {},
            },
        },
    };
});

import { MaterialProperty } from "../src/property/materialProperty";

describe("MaterialProperty", () => {
    function createMockDocument() {
        const materials: Material[] = [
            { id: "mat-1", name: "Material 1", color: "#ff0000" } as unknown as Material,
            { id: "mat-2", name: "Material 2", color: "#00ff00" } as unknown as Material,
        ];
        return {
            visual: { update: () => {} },
            modelManager: {
                materials: {
                    find: (fn: (m: any) => boolean) => materials.find(fn),
                    forEach: (fn: (m: any) => void) => materials.forEach(fn),
                },
            },
        } as any;
    }

    const propConfig: Property = {
        name: "materialId",
        type: "material",
        display: "test.material",
    } as unknown as Property;

    describe("constructor", () => {
        test("should throw when objects array is empty", () => {
            const doc = createMockDocument();
            expect(() => new MaterialProperty(doc, [], propConfig)).toThrow("there are no objects");
        });

        test("should create DOM structure with material elements", () => {
            const doc = createMockDocument();
            const obj = { materialId: "mat-1" };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            expect(prop.children.length).toBeGreaterThan(0);
        });

        test("should set PropertyBase className", () => {
            const doc = createMockDocument();
            const obj = { materialId: "mat-1" };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            expect(prop.className).toContain("panel");
        });

        test("should work with string materialId", () => {
            const doc = createMockDocument();
            const obj = { materialId: "mat-1" };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            expect(prop).toBeDefined();
            expect(prop.objects).toEqual([obj]);
        });

        test("should work with array materialId", () => {
            const doc = createMockDocument();
            const obj = { materialId: ["mat-1", "mat-2"] };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            expect(prop).toBeDefined();
            expect(prop.objects).toEqual([obj]);
        });

        test("should work with multiple objects", () => {
            const doc = createMockDocument();
            const objs = [{ materialId: "mat-1" }, { materialId: "mat-2" }];
            const prop = new MaterialProperty(doc, objs, propConfig);

            expect(prop.objects).toBe(objs);
            expect(prop.objects.length).toBe(2);
        });

        test("should contain button elements for material selection", () => {
            const doc = createMockDocument();
            const obj = { materialId: "mat-1" };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            const buttons = prop.querySelectorAll("button");
            expect(buttons.length).toBeGreaterThan(0);
        });

        test("should handle missing material gracefully", () => {
            const doc = createMockDocument();
            const obj = { materialId: "nonexistent" };
            // Material not found → empty collection, should not throw
            const prop = new MaterialProperty(doc, [obj], propConfig);
            expect(prop).toBeDefined();
        });
    });

    describe("materialCollection", () => {
        test("should find material by string id", () => {
            const doc = createMockDocument();
            const obj = { materialId: "mat-1" };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            const materials = (prop as any).materialCollection("mat-1");
            expect(materials).toBeDefined();
            expect(materials.length).toBe(1);
        });

        test("should find multiple materials by array id", () => {
            const doc = createMockDocument();
            const obj = { materialId: ["mat-1", "mat-2"] };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            const materials = (prop as any).materialCollection(["mat-1", "mat-2"]);
            expect(materials).toBeDefined();
            expect(materials.length).toBe(2);
        });

        test("should filter out missing materials from array", () => {
            const doc = createMockDocument();
            const obj = { materialId: ["mat-1", "nonexistent"] };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            const materials = (prop as any).materialCollection(["mat-1", "nonexistent"]);
            expect(materials.length).toBe(1);
        });

        test("should return empty collection for nonexistent string id", () => {
            const doc = createMockDocument();
            const obj = { materialId: "nonexistent" };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            const materials = (prop as any).materialCollection("nonexistent");
            expect(materials.length).toBe(0);
        });
    });

    describe("setMaterial", () => {
        test("should update material on the object via Transaction", () => {
            const doc = createMockDocument();
            const obj = { materialId: "mat-1" as string | string[] };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            const newMaterial = { id: "mat-3", name: "Material 3", color: "#0000ff" } as unknown as Material;

            const mockEvent = { target: document.createElement("button") } as unknown as MouseEvent;
            (prop as any).setMaterial(mockEvent, newMaterial, 0);

            // After setMaterial, the material should be updated
            expect(obj.materialId).toBe("mat-3");
        });

        test("should update material array for multi-material objects", () => {
            const doc = createMockDocument();
            const obj = { materialId: ["mat-1", "mat-2"] as string[] };
            const prop = new MaterialProperty(doc, [obj], propConfig);

            const newMaterial = { id: "mat-3", name: "Material 3", color: "#0000ff" } as unknown as Material;

            const mockEvent = { target: document.createElement("button") } as unknown as MouseEvent;
            (prop as any).setMaterial(mockEvent, newMaterial, 0);

            // After setMaterial, the first material should be replaced
            expect(obj.materialId).toEqual(["mat-3", "mat-2"]);
        });

        test("should update all objects in the objects array", () => {
            const doc = createMockDocument();
            const obj1 = { materialId: "mat-1" as string | string[] };
            const obj2 = { materialId: "mat-1" as string | string[] };
            const prop = new MaterialProperty(doc, [obj1, obj2], propConfig);

            const newMaterial = { id: "mat-3", name: "Material 3", color: "#0000ff" } as unknown as Material;

            const mockEvent = { target: document.createElement("button") } as unknown as MouseEvent;
            (prop as any).setMaterial(mockEvent, newMaterial, 0);

            expect(obj1.materialId).toBe("mat-3");
            expect(obj2.materialId).toBe("mat-3");
        });
    });
});
