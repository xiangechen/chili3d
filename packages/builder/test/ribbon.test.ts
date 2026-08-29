// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { SketchRibbonProfiles } from "@chili3d/parametric";
import { DefaultRibbon, mergeRibbonProfiles, ParametricRibbonProfiles } from "../src/ribbon";

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

    test("should not contain any sketch commands without useParametric", () => {
        const allItems = flattenItems(DefaultRibbon.flatMap((t) => t.groups.flatMap((g) => g.items)));
        expect(allItems.some((x) => x.startsWith("sketch."))).toBe(false);
        expect(DefaultRibbon.some((t) => t.tabName === "ribbon.tab.sketch")).toBe(false);
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
        // The filter above guarantees every entry is a split item.
        for (const split of splitItems as { type: string; items: unknown[] }[]) {
            expect(split.type).toBe("split");
            expect(Array.isArray(split.items)).toBe(true);
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

describe("SketchRibbonProfiles", () => {
    test("parametric tab should hold the sketch entry commands", () => {
        const tab = SketchRibbonProfiles.find((t) => t.tabName === "ribbon.tab.parametric");
        expect(tab).toBeDefined();
        expect(tab!.contextual).toBeUndefined();
        const allItems = flattenItems(tab!.groups.flatMap((g) => g.items));
        expect(allItems).toEqual(["sketch.create", "sketch.enter"]);
    });

    test("sketch tab should be contextual and contain sketch, draw, constraint, dimension groups", () => {
        const sketchTab = SketchRibbonProfiles.find((t) => t.tabName === "ribbon.tab.sketch");
        expect(sketchTab).toBeDefined();
        expect(sketchTab!.contextual).toBe(true);
        const groupNames = sketchTab!.groups.map((g) => g.groupName);
        expect(groupNames).toContain("ribbon.group.sketch");
        expect(groupNames).toContain("ribbon.group.draw");
        expect(groupNames).toContain("ribbon.group.constraint");
        expect(groupNames).toContain("ribbon.group.dimension");
        const allItems = flattenItems(sketchTab!.groups.flatMap((g) => g.items));
        expect(allItems).toContain("sketch.exit");
        expect(allItems).toContain("sketch.line");
        expect(allItems).toContain("constraint.coincident");
        expect(allItems).toContain("dimension.distance");
        expect(allItems).not.toContain("sketch.create");
    });
});

describe("ParametricRibbonProfiles", () => {
    test("should contribute the feature group to the parametric tab", () => {
        const tab = ParametricRibbonProfiles.find((t) => t.tabName === "ribbon.tab.parametric");
        expect(tab).toBeDefined();
        expect(tab!.before).toBe("ribbon.tab.manager");
        const featureGroup = tab!.groups.find((g) => g.groupName === "ribbon.group.feature");
        expect(featureGroup).toBeDefined();
        expect(flattenItems(featureGroup!.items)).toContain("feature.extrude");
    });

    test("should merge into the sketch module's parametric tab without duplicating it", () => {
        const merged = mergeRibbonProfiles(DefaultRibbon, [
            ...SketchRibbonProfiles,
            ...ParametricRibbonProfiles,
        ]);
        const parametricTabs = merged.filter((t) => t.tabName === "ribbon.tab.parametric");

        expect(parametricTabs.length).toBe(1);
        const allItems = flattenItems(parametricTabs[0].groups.flatMap((g) => g.items));
        expect(allItems).toEqual([
            "sketch.create",
            "sketch.enter",
            "feature.extrude",
            "feature.revolve",
            "feature.fillet",
            "feature.chamfer",
            "feature.fuse",
            "feature.cut",
            "feature.common",
            "feature.variable",
        ]);
    });
});

describe("mergeRibbonProfiles", () => {
    test("should insert the parametric tab before the manager tab and append the sketch tab", () => {
        const merged = mergeRibbonProfiles(DefaultRibbon, SketchRibbonProfiles);
        const tabNames = merged.map((t) => t.tabName);

        expect(tabNames).toEqual([
            "ribbon.tab.model",
            "ribbon.tab.parametric",
            "ribbon.tab.manager",
            "ribbon.tab.sketch",
        ]);
    });

    test("should not add sketch commands to the model tab", () => {
        const merged = mergeRibbonProfiles(DefaultRibbon, SketchRibbonProfiles);
        const drawGroup = merged
            .find((t) => t.tabName === "ribbon.tab.model")!
            .groups.find((g) => g.groupName === "ribbon.group.draw")!;

        expect(flattenItems(drawGroup.items).some((x) => x.startsWith("sketch."))).toBe(false);
    });

    test("should not mutate the base profiles", () => {
        mergeRibbonProfiles(DefaultRibbon, SketchRibbonProfiles);

        const allItems = flattenItems(DefaultRibbon.flatMap((t) => t.groups.flatMap((g) => g.items)));
        expect(allItems.some((x) => x.startsWith("sketch."))).toBe(false);
        expect(DefaultRibbon.some((t) => t.tabName === "ribbon.tab.sketch")).toBe(false);
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
