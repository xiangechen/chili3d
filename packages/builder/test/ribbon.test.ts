// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DefaultRibbon } from "../src/ribbon";

describe("DefaultRibbon", () => {
    test("should be a non-empty array of tab profiles", () => {
        expect(Array.isArray(DefaultRibbon)).toBe(true);
        expect(DefaultRibbon.length).toBeGreaterThan(0);
    });

    test("each tab should have a tabName and groups", () => {
        for (const tab of DefaultRibbon) {
            expect(tab.tabName).toBeDefined();
            expect(typeof tab.tabName).toBe("string");
            expect(Array.isArray(tab.groups)).toBe(true);
        }
    });

    test("each group should have a groupName and items array", () => {
        for (const tab of DefaultRibbon) {
            for (const group of tab.groups) {
                expect(group.groupName).toBeDefined();
                expect(typeof group.groupName).toBe("string");
                expect(Array.isArray(group.items)).toBe(true);
            }
        }
    });

    test("first tab should be model tab", () => {
        expect(DefaultRibbon[0].tabName).toBe("ribbon.tab.model");
    });

    test("second tab should be manager tab", () => {
        expect(DefaultRibbon[1].tabName).toBe("ribbon.tab.manager");
    });

    test("model tab should contain draw, modify, converter, boolean groups", () => {
        const modelTab = DefaultRibbon[0];
        const groupNames = modelTab.groups.map((g) => g.groupName);
        expect(groupNames).toContain("ribbon.group.draw");
        expect(groupNames).toContain("ribbon.group.modify");
        expect(groupNames).toContain("ribbon.group.converter");
        expect(groupNames).toContain("ribbon.group.boolean");
        expect(groupNames).toContain("ribbon.group.workingPlane");
        expect(groupNames).toContain("ribbon.group.tools");
        expect(groupNames).toContain("ribbon.group.measure");
        expect(groupNames).toContain("ribbon.group.act");
        expect(groupNames).toContain("ribbon.group.importExport");
    });

    test("draw group should contain create commands", () => {
        const drawGroup = DefaultRibbon[0].groups.find((g) => g.groupName === "ribbon.group.draw");
        expect(drawGroup).toBeDefined();
        const allItems = flattenItems(drawGroup!.items);
        expect(allItems).toContain("create.extrude");
        expect(allItems).toContain("create.box");
    });

    test("modify group should contain modify commands", () => {
        const modifyGroup = DefaultRibbon[0].groups.find((g) => g.groupName === "ribbon.group.modify");
        expect(modifyGroup).toBeDefined();
        const allItems = flattenItems(modifyGroup!.items);
        expect(allItems).toContain("modify.move");
        expect(allItems).toContain("modify.rotate");
        expect(allItems).toContain("modify.fillet");
    });

    test("boolean group should contain boolean commands", () => {
        const booleanGroup = DefaultRibbon[0].groups.find((g) => g.groupName === "ribbon.group.boolean");
        expect(booleanGroup).toBeDefined();
        const allItems = flattenItems(booleanGroup!.items);
        expect(allItems).toContain("boolean.common");
        expect(allItems).toContain("boolean.cut");
        expect(allItems).toContain("boolean.join");
    });

    test("split-type items should have type and items properties", () => {
        const drawGroup = DefaultRibbon[0].groups.find((g) => g.groupName === "ribbon.group.draw");
        const splitItems = drawGroup!.items.filter(
            (item) => typeof item === "object" && "type" in item && item.type === "split",
        );
        expect(splitItems.length).toBeGreaterThan(0);
        for (const split of splitItems) {
            if (typeof split === "object" && "type" in split) {
                expect(split.type).toBe("split");
                expect(Array.isArray(split.items)).toBe(true);
            }
        }
    });

    test("groups should support collapsedItems", () => {
        const drawGroup = DefaultRibbon[0].groups.find((g) => g.groupName === "ribbon.group.draw");
        expect(drawGroup!.collapsedItems).toBeDefined();
        expect(Array.isArray(drawGroup!.collapsedItems)).toBe(true);
    });

    test("all tab names should start with ribbon.tab.", () => {
        for (const tab of DefaultRibbon) {
            expect(tab.tabName.startsWith("ribbon.tab.")).toBe(true);
        }
    });

    test("all group names should start with ribbon.group.", () => {
        for (const tab of DefaultRibbon) {
            for (const group of tab.groups) {
                expect(group.groupName.startsWith("ribbon.group.")).toBe(true);
            }
        }
    });
});

/** Recursively flatten item entries that may be strings, string arrays, or {type, items} objects. */
function flattenItems(items: any[]): string[] {
    const result: string[] = [];
    for (const item of items) {
        if (typeof item === "string") {
            result.push(item);
        } else if (Array.isArray(item)) {
            result.push(...item);
        } else if (typeof item === "object" && "items" in item && Array.isArray(item.items)) {
            result.push(...flattenItems(item.items));
        }
    }
    return result;
}
