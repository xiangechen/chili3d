// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Ribbon, RibbonGroup, RibbonTab } from "../src/ui/ribbon";

describe("RibbonGroup", () => {
    describe("constructor", () => {
        test("should create with groupName and items", () => {
            const group = new RibbonGroup("ribbon.group.sketch" as any, ["command.create.box" as any]);

            expect(group.groupName).toBe("ribbon.group.sketch");
            expect(group.items.length).toBe(1);
            expect(group.collapsedItems.length).toBe(0);
        });

        test("should create with collapsedItems", () => {
            const group = new RibbonGroup(
                "ribbon.group.sketch" as any,
                ["command.create.box" as any],
                ["command.create.sphere" as any],
            );

            expect(group.collapsedItems.length).toBe(1);
        });

        test("should set groupName via setter", () => {
            const group = new RibbonGroup("ribbon.group.sketch" as any, []);

            group.groupName = "ribbon.group.model" as any;

            expect(group.groupName).toBe("ribbon.group.model");
        });
    });

    describe("items", () => {
        test("should be an ObservableCollection", () => {
            const group = new RibbonGroup("ribbon.group.sketch" as any, []);

            expect(group.items).not.toBeNull();
            expect(typeof group.items.push).toBe("function");
            expect(typeof group.items.length).toBe("number");
        });

        test("should contain passed items", () => {
            const group = new RibbonGroup("ribbon.group.sketch" as any, [
                "command.create.box" as any,
                "command.create.sphere" as any,
            ]);

            expect(group.items.length).toBe(2);
        });
    });

    describe("fromProfile", () => {
        test("should create from profile with simple commands", () => {
            const profile = {
                groupName: "ribbon.group.sketch" as any,
                items: ["command.a" as any, "command.b" as any],
            };

            const group = RibbonGroup.fromProfile(profile);

            expect(group.groupName).toBe("ribbon.group.sketch");
            expect(group.items.length).toBe(2);
        });

        test("should handle nested arrays as ObservableCollections", () => {
            const profile = {
                groupName: "ribbon.group.sketch" as any,
                items: [["command.a" as any, "command.b" as any], "command.c" as any],
            };

            const group = RibbonGroup.fromProfile(profile);

            expect(group.items.length).toBe(2);
        });

        test("should handle collapsedItems", () => {
            const profile = {
                groupName: "ribbon.group.sketch" as any,
                items: ["command.a" as any],
                collapsedItems: ["command.b" as any],
            };

            const group = RibbonGroup.fromProfile(profile);

            expect(group.collapsedItems.length).toBe(1);
        });

        test("should handle missing collapsedItems", () => {
            const profile = {
                groupName: "ribbon.group.sketch" as any,
                items: ["command.a" as any],
            };

            const group = RibbonGroup.fromProfile(profile);

            expect(group.collapsedItems.length).toBe(0);
        });
    });
});

describe("RibbonTab", () => {
    describe("constructor", () => {
        test("should create with tabName and groups", () => {
            const group1 = new RibbonGroup("ribbon.group.sketch" as any, []);
            const group2 = new RibbonGroup("ribbon.group.model" as any, []);

            const tab = new RibbonTab("ribbon.tab.model" as any, group1, group2);

            expect(tab.tabName).toBe("ribbon.tab.model");
            expect(tab.groups.length).toBe(2);
        });

        test("should create with no groups", () => {
            const tab = new RibbonTab("ribbon.tab.model" as any);

            expect(tab.groups.length).toBe(0);
        });

        test("should set tabName via setter", () => {
            const tab = new RibbonTab("ribbon.tab.model" as any);

            tab.tabName = "ribbon.tab.sketch" as any;

            expect(tab.tabName).toBe("ribbon.tab.sketch");
        });
    });

    describe("groups", () => {
        test("should be an ObservableCollection", () => {
            const tab = new RibbonTab("ribbon.tab.model" as any);

            expect(tab.groups).not.toBeNull();
            expect(typeof tab.groups.push).toBe("function");
        });
    });

    describe("fromProfile", () => {
        test("should create tab from profile with groups", () => {
            const profile = {
                tabName: "ribbon.tab.model" as any,
                groups: [
                    {
                        groupName: "ribbon.group.sketch" as any,
                        items: ["command.create.box" as any],
                    },
                    {
                        groupName: "ribbon.group.modify" as any,
                        items: ["command.modify.fillet" as any],
                    },
                ],
            };

            const tab = RibbonTab.fromProfile(profile);

            expect(tab.tabName).toBe("ribbon.tab.model");
            expect(tab.groups.length).toBe(2);
        });

        test("contextual tab should start hidden", () => {
            const tab = RibbonTab.fromProfile({
                tabName: "ribbon.tab.sketch" as any,
                groups: [],
                contextual: true,
            });

            expect(tab.contextual).toBe(true);
            expect(tab.visible).toBe(false);
        });

        test("non-contextual tab should be visible by default", () => {
            const tab = RibbonTab.fromProfile({ tabName: "ribbon.tab.model" as any, groups: [] });

            expect(tab.contextual).toBe(false);
            expect(tab.visible).toBe(true);
        });
    });
});

describe("Ribbon", () => {
    let tab1: RibbonTab;
    let tab2: RibbonTab;

    beforeEach(() => {
        tab1 = new RibbonTab(
            "ribbon.tab.model" as any,
            new RibbonGroup("ribbon.group.sketch" as any, ["command.create.box" as any]),
        );
        tab2 = new RibbonTab(
            "ribbon.tab.sketch" as any,
            new RibbonGroup("ribbon.group.draw" as any, ["command.create.line" as any]),
        );
    });

    describe("constructor", () => {
        test("should create with quickCommands and tabs", () => {
            const ribbon = new Ribbon(["command.undo" as any, "command.redo" as any], [tab1, tab2]);

            expect(ribbon.quickCommands.length).toBe(2);
            expect(ribbon.tabs.length).toBe(2);
            expect(ribbon.activeTab).toBe(tab1);
        });

        test("should set first tab as active", () => {
            const ribbon = new Ribbon([], [tab1, tab2]);

            expect(ribbon.activeTab).toBe(tab1);
        });
    });

    describe("activeTab", () => {
        test("should set and get activeTab", () => {
            const ribbon = new Ribbon([], [tab1, tab2]);

            ribbon.activeTab = tab2;

            expect(ribbon.activeTab).toBe(tab2);
        });
    });

    describe("setActiveTab", () => {
        test("should set active tab by name", () => {
            const ribbon = new Ribbon([], [tab1, tab2]);

            ribbon.setActiveTab("ribbon.tab.sketch" as any);

            expect(ribbon.activeTab).toBe(tab2);
        });

        test("should log error for non-existent tab name", () => {
            const originalError = console.error;
            let calledWith = "";
            console.error = (msg: string) => {
                calledWith = msg;
            };
            const ribbon = new Ribbon([], [tab1]);

            ribbon.setActiveTab("ribbon.tab.nonexistent" as any);

            expect(calledWith).toContain("Can't find tab ribbon.tab.nonexistent");

            console.error = originalError;
        });
    });

    describe("combineRibbonTab", () => {
        test("should add new tab if tab does not exist", () => {
            const ribbon = new Ribbon([], [tab1]);

            ribbon.combineRibbonTab({
                tabName: "ribbon.tab.sketch" as any,
                groups: [
                    {
                        groupName: "ribbon.group.draw" as any,
                        items: ["command.create.line" as any],
                    },
                ],
            });

            expect(ribbon.tabs.length).toBe(2);
        });

        test("should add new group to existing tab", () => {
            const ribbon = new Ribbon([], [tab1]);
            const tabName = tab1.tabName;

            ribbon.combineRibbonTab({
                tabName,
                groups: [
                    {
                        groupName: "ribbon.group.modify" as any,
                        items: ["command.modify.fillet" as any],
                    },
                ],
            });

            expect(tab1.groups.length).toBe(2);
        });

        test("should merge commands into existing group", () => {
            const ribbon = new Ribbon([], [tab1]);
            const tabName = tab1.tabName;

            ribbon.combineRibbonTab({
                tabName,
                groups: [
                    {
                        groupName: "ribbon.group.sketch" as any,
                        items: ["command.create.sphere" as any],
                    },
                ],
            });

            // The existing group "ribbon.group.sketch" should now have 2 items
            expect(tab1.groups.length).toBe(1);
            const sketchGroup = tab1.groups.find(
                (g: RibbonGroup) => (g.groupName as string) === "ribbon.group.sketch",
            );
            expect(sketchGroup).not.toBeNull();
            expect(sketchGroup!.items.length).toBe(2);
        });

        test("should handle nested array items when merging", () => {
            const ribbon = new Ribbon([], [tab1]);
            const tabName = tab1.tabName;

            ribbon.combineRibbonTab({
                tabName,
                groups: [
                    {
                        groupName: "ribbon.group.sketch" as any,
                        items: [["command.a" as any, "command.b" as any]],
                    },
                ],
            });

            const sketchGroup = tab1.groups.find(
                (g: RibbonGroup) => (g.groupName as string) === "ribbon.group.sketch",
            );
            expect(sketchGroup!.items.length).toBe(2);
        });
    });

    describe("addRibbonCommand", () => {
        test("should add command to existing tab and group", () => {
            const ribbon = new Ribbon([], [tab1]);

            ribbon.addRibbonCommand(
                "ribbon.tab.model" as any,
                "ribbon.group.sketch" as any,
                "command.create.sphere" as any,
            );

            const group = tab1.groups.find(
                (g: RibbonGroup) => (g.groupName as string) === "ribbon.group.sketch",
            );
            expect(group!.items.length).toBe(2);
        });

        test("should not throw when tab not found", () => {
            const ribbon = new Ribbon([], [tab1]);

            expect(() => {
                ribbon.addRibbonCommand(
                    "ribbon.tab.nonexistent" as any,
                    "ribbon.group.sketch" as any,
                    "command.create.sphere" as any,
                );
            }).not.toThrow();
        });

        test("should not throw when group not found", () => {
            const ribbon = new Ribbon([], [tab1]);

            expect(() => {
                ribbon.addRibbonCommand(
                    "ribbon.tab.model" as any,
                    "ribbon.group.nonexistent" as any,
                    "command.create.sphere" as any,
                );
            }).not.toThrow();
        });
    });

    describe("openTab/closeTab", () => {
        const contextualTab = () =>
            RibbonTab.fromProfile({ tabName: "ribbon.tab.sketch" as any, groups: [], contextual: true });

        test("should activate the first visible tab", () => {
            const ribbon = new Ribbon([], [contextualTab(), tab1]);

            expect(ribbon.activeTab).toBe(tab1);
        });

        test("openTab should reveal and activate a contextual tab", () => {
            const sketchTab = contextualTab();
            const ribbon = new Ribbon([], [tab1, sketchTab]);

            ribbon.openTab("ribbon.tab.sketch" as any);

            expect(sketchTab.visible).toBe(true);
            expect(ribbon.activeTab).toBe(sketchTab);
        });

        test("openTab should ignore an unknown tab name", () => {
            const ribbon = new Ribbon([], [tab1, tab2]);

            ribbon.openTab("ribbon.tab.nonexistent" as any);

            expect(ribbon.activeTab).toBe(tab1);
        });

        test("closeTab should hide a contextual tab and restore the previous tab", () => {
            const sketchTab = contextualTab();
            const ribbon = new Ribbon([], [tab1, sketchTab]);
            ribbon.openTab("ribbon.tab.sketch" as any);

            ribbon.closeTab("ribbon.tab.sketch" as any);

            expect(sketchTab.visible).toBe(false);
            expect(ribbon.activeTab).toBe(tab1);
        });

        test("closeTab should keep a non-contextual tab visible", () => {
            const ribbon = new Ribbon([], [tab1, tab2]);
            ribbon.openTab("ribbon.tab.sketch" as any);

            ribbon.closeTab("ribbon.tab.sketch" as any);

            expect(tab2.visible).toBe(true);
            expect(ribbon.activeTab).toBe(tab1);
        });
    });
});
