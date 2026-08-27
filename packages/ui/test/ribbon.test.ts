// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys, IApplication, PushButton, Ribbon } from "@chili3d/core";
import { CommandStore, PubSub, RibbonGroup, RibbonTab } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";

// CSS modules under test (plus those of the ribbon buttons pulled in transitively)
rs.mock("../src/ribbon/ribbon.module.css", () => ({
    root: "r-root",
    titleBar: "r-title-bar",
    left: "r-left",
    appIcon: "r-app-icon",
    icon: "r-icon",
    ribbonTitlePanel: "r-ribbon-title-panel",
    home: "r-home",
    quickCommands: "r-quick-commands",
    split: "r-split",
    tabHeader: "r-tab-header",
    activedTab: "r-actived-tab",
    center: "r-center",
    views: "r-views",
    new: "r-new",
    tab: "r-tab",
    active: "r-active",
    name: "r-name",
    close: "r-close",
    right: "r-right",
    tabContentPanel: "r-tab-content-panel",
    groupPanel: "r-group-panel",
    disabled: "r-disabled",
}));

rs.mock("../src/ribbon/ribbonGroup.module.css", () => ({
    ribbonGroup: "rg-group",
    content: "rg-content",
    headerContainer: "rg-header-container",
    header: "rg-header",
    arrow: "rg-arrow",
    collapsedDropdown: "rg-collapsed-dropdown",
    collapsedDropdownItem: "rg-collapsed-item",
    collapsedDropdownIcon: "rg-collapsed-icon",
    collapsedDropdownText: "rg-collapsed-text",
}));

rs.mock("../src/ribbon/ribbonStack.module.css", () => ({
    root: "rs-root",
}));

rs.mock("../src/ribbon/ribbonButton.module.css", () => ({
    normal: "rb-normal",
    small: "rb-small",
    icon: "rb-icon",
    smallIcon: "rb-small-icon",
    largeButtonText: "rb-large-text",
    smallButtonText: "rb-small-text",
    checked: "rb-checked",
}));

rs.mock("../src/ribbon/ribbonPulldownButton.module.css", () => ({
    pulldown: "rpd-pulldown",
    pulldownSmall: "rpd-pulldown-small",
    text: "rpd-text",
    smallText: "rpd-text-small",
    arrow: "rpd-arrow",
    smallArrow: "rpd-arrow-small",
    dropdown: "rpd-dropdown",
    dropdownItem: "rpd-dropdown-item",
    dropdownIcon: "rpd-dropdown-icon",
    dropdownText: "rpd-dropdown-text",
}));

rs.mock("../src/ribbon/ribbonSplitButton.module.css", () => ({
    split: "rsb-split",
    splitSmall: "rsb-split-small",
    mainArea: "rsb-main",
    smallMainArea: "rsb-main-small",
    arrowButton: "rsb-arrow-btn",
    smallArrowButton: "rsb-arrow-btn-small",
    arrow: "rsb-arrow",
    smallArrow: "rsb-arrow-small",
    text: "rsb-text",
    smallText: "rsb-text-small",
    dropdown: "rsb-dropdown",
    dropdownItem: "rsb-dropdown-item",
    dropdownIcon: "rsb-dropdown-icon",
    dropdownText: "rsb-dropdown-text",
}));

// Mock element helpers — real events so el.click() triggers handlers
import "./_helpers/mockElementRealEvents";

import { RibbonUI } from "../src/ribbon/ribbon";
import { mustQuery } from "./_helpers/domHelpers";

const CMD_QUICK = "test.ribbon.quick" as unknown as CommandKeys;

class TestCommand {
    async execute() {}
}

function makePushButton(): PushButton {
    return {
        type: "push",
        size: "large",
        command: CMD_QUICK,
        icon: "icon-test",
        onClick: () => {},
    } as PushButton;
}

function makeTab(name: string): RibbonTab {
    const group = new RibbonGroup("group.test" as RibbonGroup["groupName"], [makePushButton()]);
    return new RibbonTab(name as RibbonTab["tabName"], group);
}

describe("RibbonUI", () => {
    let published: { topic: string; args: unknown[] }[];
    let pubCallback: (...args: unknown[]) => void;
    let homeCallback: (...args: unknown[]) => void;

    beforeEach(() => {
        published = [];
        pubCallback = (...args: unknown[]) => published.push({ topic: "executeCommand", args });
        homeCallback = (...args: unknown[]) => published.push({ topic: "displayHome", args });
        PubSub.default.sub("executeCommand", pubCallback);
        PubSub.default.sub("displayHome", homeCallback);
        CommandStore.registerCommand(TestCommand, { key: CMD_QUICK, icon: "icon-quick" });
    });

    afterEach(() => {
        PubSub.default.remove("executeCommand", pubCallback);
        PubSub.default.remove("displayHome", homeCallback);
        CommandStore.unregisterCommand(CMD_QUICK);
    });

    function createRibbonUI() {
        const tab1 = makeTab("tab.one");
        const tab2 = makeTab("tab.two");
        const dataContent = {
            quickCommands: [CMD_QUICK],
            tabs: [tab1, tab2],
            activeTab: tab1,
        } as unknown as Ribbon;
        const app = { views: [], mainWindow: undefined } as unknown as IApplication;
        const ui = new RibbonUI(app, dataContent);
        return { ui, dataContent, tab1, tab2 };
    }

    test("should render root, title bar and app name", () => {
        const { ui } = createRibbonUI();
        expect(ui.className).toBe("r-root");
        expect(ui.querySelector(".r-title-bar")).not.toBeNull();

        const appName = mustQuery(ui, "#appName");
        expect(appName.textContent).toContain("Chili3D - v");
    });

    test("should render github link", () => {
        const { ui } = createRibbonUI();
        const link = mustQuery(ui, "a");
        expect(link.getAttribute("href")).toBe("https://github.com/xiangechen/chili3d");
    });

    test("should render ribbon groups for each tab", () => {
        const { ui } = createRibbonUI();
        const groups = ui.querySelectorAll("ribbon-group");
        expect(groups.length).toBe(2);
    });

    test("should publish displayHome when app icon clicked", () => {
        const { ui } = createRibbonUI();
        const appIcon = mustQuery(ui, ".r-app-icon");
        appIcon.click();
        expect(published.some((p) => p.topic === "displayHome" && p.args[0] === true)).toBe(true);
    });

    test("should publish executeCommand when quick command clicked", () => {
        const { ui } = createRibbonUI();
        const titlePanel = mustQuery(ui, ".r-ribbon-title-panel");
        // children: home svg, quickCommands collection, split span, tab headers collection
        const quickContainer = titlePanel.children[1] as HTMLElement;
        const quickButton = mustQuery(quickContainer, "span");
        quickButton.click();
        expect(published.some((p) => p.topic === "executeCommand" && p.args[0] === CMD_QUICK)).toBe(true);
    });

    test("should switch activeTab when tab header clicked", () => {
        const { ui, dataContent, tab2 } = createRibbonUI();
        const titlePanel = mustQuery(ui, ".r-ribbon-title-panel");
        const tabHeaderContainer = titlePanel.children[3] as HTMLElement;
        const tabLabels = tabHeaderContainer.querySelectorAll("label");
        expect(tabLabels.length).toBe(2);

        (tabLabels[1] as HTMLElement).click();
        expect(dataContent.activeTab).toBe(tab2);
    });

    test("should publish doc.new when new-view button clicked", () => {
        const { ui } = createRibbonUI();
        const newBtn = mustQuery(ui, "svg[icon='icon-plus']");
        // The svg mock stores handlers on `_onclick` regardless of realEvents
        const onclick = (newBtn as unknown as { _onclick?: () => void })._onclick;
        expect(onclick).toBeDefined();
        onclick!();
        expect(published.some((p) => p.topic === "executeCommand" && p.args[0] === "doc.new")).toBe(true);
    });
});
