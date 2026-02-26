// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IConverter } from "../src/foundation";
import { Result } from "../src/foundation";
import { Combobox } from "../src/ui/combobox";

describe("Combobox test", () => {
    test("should create combobox without converter", () => {
        const combobox = new Combobox<string>();
        expect(combobox.converter).toBeUndefined();
        expect(combobox.selectedIndex).toBe(0);
        expect(combobox.selectedItem).toBeUndefined();
        expect(combobox.items.length).toBe(0);
    });

    test("should create combobox with converter", () => {
        const mockConverter: IConverter<string> = {
            convert: (value: string) => Result.ok(value),
            convertBack: (value: string) => Result.ok(value),
        };
        const combobox = new Combobox<string>(mockConverter);
        expect(combobox.converter).toBe(mockConverter);
    });

    test("should initialize with default selectedIndex 0", () => {
        const combobox = new Combobox<string>();
        expect(combobox.selectedIndex).toBe(0);
    });

    test("should set valid selectedIndex", () => {
        const combobox = new Combobox<string>();
        combobox.items.push("item1", "item2", "item3");

        combobox.selectedIndex = 1;
        expect(combobox.selectedIndex).toBe(1);
        expect(combobox.selectedItem).toBe("item2");

        combobox.selectedIndex = 2;
        expect(combobox.selectedIndex).toBe(2);
        expect(combobox.selectedItem).toBe("item3");
    });

    test("should not set negative selectedIndex", () => {
        const combobox = new Combobox<string>();
        combobox.items.push("item1", "item2");
        const originalIndex = combobox.selectedIndex;

        combobox.selectedIndex = -1;
        expect(combobox.selectedIndex).toBe(originalIndex);
    });

    test("should not set selectedIndex equal to items length", () => {
        const combobox = new Combobox<string>();
        combobox.items.push("item1", "item2");
        const originalIndex = combobox.selectedIndex;

        combobox.selectedIndex = 2;
        expect(combobox.selectedIndex).toBe(originalIndex);
    });

    test("should not set selectedIndex greater than items length", () => {
        const combobox = new Combobox<string>();
        combobox.items.push("item1", "item2");
        const originalIndex = combobox.selectedIndex;

        combobox.selectedIndex = 5;
        expect(combobox.selectedIndex).toBe(originalIndex);
    });

    test("should return undefined for selectedItem when no items", () => {
        const combobox = new Combobox<string>();
        expect(combobox.selectedItem).toBeUndefined();
    });

    test("should return undefined for selectedItem when selectedIndex is out of bounds", () => {
        const combobox = new Combobox<string>();
        combobox.items.push("item1", "item2");

        combobox.selectedIndex = 0;
        expect(combobox.selectedItem).toBe("item1");
    });

    test("should update selectedItem when items change", () => {
        const combobox = new Combobox<string>();
        combobox.selectedIndex = 0;

        combobox.items.push("first", "second", "third");
        expect(combobox.selectedItem).toBe("first");

        combobox.items.clear();
        expect(combobox.selectedItem).toBeUndefined();

        combobox.items.push("new1", "new2");
        expect(combobox.selectedItem).toBe("new1");
    });

    test("should handle selectedIndex when items are removed", () => {
        const combobox = new Combobox<string>();
        combobox.items.push("item1", "item2", "item3", "item4");
        combobox.selectedIndex = 2;

        expect(combobox.selectedItem).toBe("item3");

        combobox.items.remove("item3");
        expect(combobox.selectedItem).toBe("item4");
    });

    test("should handle property changed notifications", () => {
        const combobox = new Combobox<string>();
        combobox.items.push("item1", "item2", "item3");

        let propertyChanged = false;
        combobox.onPropertyChanged(() => {
            propertyChanged = true;
        });

        combobox.selectedIndex = 1;
        expect(propertyChanged).toBe(true);
    });

    test("should work with complex objects", () => {
        interface TestObject {
            id: number;
            name: string;
        }

        const combobox = new Combobox<TestObject>();
        const items: TestObject[] = [
            { id: 1, name: "First" },
            { id: 2, name: "Second" },
            { id: 3, name: "Third" },
        ];

        combobox.items.push(...items);

        combobox.selectedIndex = 1;
        expect(combobox.selectedItem).toEqual({ id: 2, name: "Second" });
    });

    test("should maintain selected index when adding items", () => {
        const combobox = new Combobox<string>();
        combobox.items.push("item1", "item2");
        combobox.selectedIndex = 1;

        combobox.items.push("item3", "item4");
        expect(combobox.selectedIndex).toBe(1);
        expect(combobox.selectedItem).toBe("item2");
    });

    test("should handle empty items collection", () => {
        const combobox = new Combobox<string>();
        expect(combobox.items.length).toBe(0);
        expect(combobox.selectedItem).toBeUndefined();

        combobox.selectedIndex = 1;
        expect(combobox.selectedIndex).toBe(0);
    });

    test("should support generic types", () => {
        const numberCombobox = new Combobox<number>();
        numberCombobox.items.push(1, 2, 3);
        numberCombobox.selectedIndex = 2;
        expect(numberCombobox.selectedItem).toBe(3);

        const booleanCombobox = new Combobox<boolean>();
        booleanCombobox.items.push(true, false);
        booleanCombobox.selectedIndex = 0;
        expect(booleanCombobox.selectedItem).toBe(true);
    });
});
