// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys, PushButton, RibbonButton, RibbonCommand } from "@chili3d/core";
import { CommandStore, ObservableCollection, PubSub, RibbonGroup } from "@chili3d/core";
import { afterEach, describe, expect, test } from "@rstest/core";

// CSS modules under test (plus those of buttons created via createRibbonButton)
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

import { RibbonPushButton } from "../src/ribbon/ribbonButton";
import { createRibbonButton, RibbonGroupElement } from "../src/ribbon/ribbonGroup";
import { RibbonPulldownButton } from "../src/ribbon/ribbonPulldownButton";
import { RibbonSplitButton } from "../src/ribbon/ribbonSplitButton";
import { RibbonStack } from "../src/ribbon/ribbonStack";
import { mustQuery } from "./_helpers/domHelpers";

const CMD_A = "test.group.a" as unknown as CommandKeys;
const CMD_B = "test.group.b" as unknown as CommandKeys;

class TestCommand {
    async execute() {}
}

function makePushButton(command: CommandKeys): PushButton {
    return { type: "push", command, icon: "icon-test", onClick: () => {} } as PushButton;
}

function makeGroup(items: RibbonCommand[] = [], collapsedItems: CommandKeys[] = []): RibbonGroup {
    return new RibbonGroup("group.test" as RibbonGroup["groupName"], items, collapsedItems);
}

function mustCreateRibbonButton(item: RibbonCommand): HTMLElement {
    const button = createRibbonButton(item);
    if (!button) throw new Error("expected a ribbon button");
    return button;
}

describe("RibbonStack", () => {
    test("should apply root class", () => {
        const stack = new RibbonStack();
        expect(stack.className).toBe("rs-root");
    });
});

describe("createRibbonButton", () => {
    afterEach(() => {
        CommandStore.unregisterCommand(CMD_A);
        CommandStore.unregisterCommand(CMD_B);
    });

    test("should create push button from registered command name", () => {
        CommandStore.registerCommand(TestCommand, { key: CMD_A, icon: "icon-a" });
        const el = createRibbonButton(CMD_A);
        expect(el).toBeInstanceOf(RibbonPushButton);
    });

    test("should create stack of small buttons from ObservableCollection", () => {
        CommandStore.registerCommand(TestCommand, { key: CMD_A, icon: "icon-a" });
        CommandStore.registerCommand(TestCommand, { key: CMD_B, icon: "icon-b" });
        const el = mustCreateRibbonButton(new ObservableCollection<CommandKeys>(CMD_A, CMD_B));
        expect(el).toBeInstanceOf(RibbonStack);
        expect(el.childElementCount).toBe(2);
        expect(el.children[0].className).toBe("rb-small");
    });

    test("should stack small pulldown and split buttons too", () => {
        const pulldown: RibbonButton = {
            type: "pulldown",
            icon: "icon-pd",
            display: "PD" as never,
            items: [],
        };
        const split: RibbonButton = { type: "split", items: [makePushButton(CMD_B)] };
        const el = mustCreateRibbonButton(
            new ObservableCollection<RibbonButton>(makePushButton(CMD_A), pulldown, split),
        );

        expect(el).toBeInstanceOf(RibbonStack);
        expect(el.childElementCount).toBe(3);
        expect(el.children[1]).toBeInstanceOf(RibbonPulldownButton);
        expect(el.children[1].className).toBe("rpd-pulldown-small");
        expect(el.children[2]).toBeInstanceOf(RibbonSplitButton);
        expect(el.children[2].className).toBe("rsb-split-small");
    });

    test("should return undefined for a command this build does not register", () => {
        expect(createRibbonButton(CMD_B)).toBeUndefined();
    });

    test("should return undefined for a stack whose commands are all unregistered", () => {
        expect(createRibbonButton(new ObservableCollection<CommandKeys>(CMD_B))).toBeUndefined();
    });

    test("should create push button from push item", () => {
        const el = createRibbonButton(makePushButton(CMD_A));
        expect(el).toBeInstanceOf(RibbonPushButton);
    });

    test("should create pulldown button from pulldown item", () => {
        const el = createRibbonButton({
            type: "pulldown",
            icon: "icon-pd",
            display: "PD" as never,
            items: [],
        } as RibbonCommand);
        expect(el).toBeInstanceOf(RibbonPulldownButton);
    });

    test("should create split button from split item", () => {
        const el = createRibbonButton({
            type: "split",
            items: [makePushButton(CMD_A)],
        } as RibbonCommand);
        expect(el).toBeInstanceOf(RibbonSplitButton);
    });

    test("should throw for unknown item type", () => {
        expect(() => createRibbonButton({ type: "unknown" } as unknown as RibbonCommand)).toThrow(
            "unknown ribbon button type",
        );
    });
});

describe("RibbonGroupElement", () => {
    afterEach(() => {
        CommandStore.unregisterCommand(CMD_A);
        CommandStore.unregisterCommand(CMD_B);
        document.body.querySelectorAll(".rg-collapsed-dropdown").forEach((el) => el.remove());
    });

    test("should render group with content buttons and header", () => {
        const group = makeGroup([makePushButton(CMD_A), makePushButton(CMD_B)]);
        const el = new RibbonGroupElement(group);
        expect(el.className).toBe("rg-group");

        // The collection mock does not apply className — the content container is the
        // first child appended by initHTML.
        const content = el.children[0] as HTMLElement;
        expect(content).toBeInstanceOf(HTMLElement);
        expect(content.childElementCount).toBe(2);

        const header = el.querySelector(".rg-header");
        expect(header).not.toBeNull();

        expect(el.querySelector(".rg-arrow")).not.toBeNull();
    });

    test("should not open collapsed dropdown when collapsedItems is empty", () => {
        const el = new RibbonGroupElement(makeGroup());
        document.body.appendChild(el);
        try {
            mustQuery(el, ".rg-arrow").click();
            expect(document.body.querySelector(".rg-collapsed-dropdown")).toBeNull();
        } finally {
            el.dispose();
            el.remove();
        }
    });

    test("should open collapsed dropdown with collapsed items on arrow click", () => {
        CommandStore.registerCommand(TestCommand, { key: CMD_A, icon: "icon-a" });
        CommandStore.registerCommand(TestCommand, { key: CMD_B, icon: "icon-b" });
        const group = makeGroup([], [CMD_A, CMD_B]);
        const el = new RibbonGroupElement(group);
        document.body.appendChild(el);
        try {
            mustQuery(el, ".rg-arrow").click();
            const dropdown = document.body.querySelector(".rg-collapsed-dropdown");
            expect(dropdown).not.toBeNull();
            expect(dropdown!.querySelectorAll(".rg-collapsed-item").length).toBe(2);
        } finally {
            el.dispose();
            el.remove();
        }
    });

    test("should publish executeCommand and close when collapsed item clicked", () => {
        CommandStore.registerCommand(TestCommand, { key: CMD_A, icon: "icon-a" });
        const published: string[] = [];
        const callback = (cmd: string) => published.push(cmd);
        PubSub.default.sub("executeCommand", callback);
        const group = makeGroup([], [CMD_A]);
        const el = new RibbonGroupElement(group);
        document.body.appendChild(el);
        try {
            mustQuery(el, ".rg-arrow").click();
            const item = mustQuery(document.body, ".rg-collapsed-item");
            item.click();
            expect(published).toContain(CMD_A);
            expect(document.body.querySelector(".rg-collapsed-dropdown")).toBeNull();
        } finally {
            PubSub.default.remove("executeCommand", callback);
            el.dispose();
            el.remove();
        }
    });
});
