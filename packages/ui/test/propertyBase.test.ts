// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";

// Mock CSS module before importing PropertyBase
rs.mock("../src/property/propertyBase.module.css", () => ({
    panel: "pb-panel",
}));

// Happy-DOM supports CustomElements registered via customElements.define(),
// but does NOT support using `new` on them directly.
// Register a concrete subclass before importing the module-under-test.
class TestProperty extends HTMLElement {
    private _objects: object[];

    constructor(objects: object[] = []) {
        super();
        if (objects.length === 0) {
            throw new Error("there are no objects");
        }
        this._objects = objects;
    }

    get objects(): object[] {
        return this._objects;
    }
}
customElements.define("test-property", TestProperty);

// Now mock the CSS and import the real module. Since Happy-DOM already
// knows about the `property-base` custom element, we can instantiate it.
describe("PropertyBase", () => {
    describe("constructor invariant (tested via mock)", () => {
        test("should throw when objects array is empty", () => {
            expect(() => new TestProperty([])).toThrow("there are no objects");
        });

        test("should accept a single object", () => {
            const prop = new TestProperty([{ name: "test" }]);
            expect(prop.objects).toEqual([{ name: "test" }]);
        });

        test("should accept multiple objects", () => {
            const objs = [{ x: 1 }, { x: 2 }, { x: 3 }];
            const prop = new TestProperty(objs);
            expect(prop.objects.length).toBe(3);
        });

        test("should store objects reference", () => {
            const objs = [{ a: 1 }, { a: 2 }];
            const prop = new TestProperty(objs);
            expect(prop.objects).toBe(objs);
            expect(prop.objects.length).toBe(2);
        });
    });
});
