// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys, PushButton, SplitButton } from "@chili3d/core";
import { CommandStore, PubSub } from "@chili3d/core";
import { afterEach, describe, expect, rs, test } from "@rstest/core";

// CSS modules under test
rs.mock("../src/ribbon/ribbonButton.module.css", () => ({
    normal: "rb-normal",
    small: "rb-small",
    icon: "rb-icon",
    smallIcon: "rb-small-icon",
    largeButtonText: "rb-large-text",
    smallButtonText: "rb-small-text",
    checked: "rb-checked",
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

import { RibbonSplitButton } from "../src/ribbon/ribbonSplitButton";

const CMD_A = "test.split.a" as unknown as CommandKeys;
const CMD_B = "test.split.b" as unknown as CommandKeys;

class TestCommand {
    async execute() {}
}

function makePushButton(command: CommandKeys, icon: string, onClick: () => void): PushButton {
    return { type: "push", command, icon, onClick } as PushButton;
}

function makeSplitData(items: SplitButton["items"]): SplitButton {
    return { type: "split", items } as SplitButton;
}

function mainArea(btn: HTMLElement): HTMLElement {
    const el = btn.querySelector(".rsb-main, .rsb-main-small");
    expect(el).not.toBeNull();
    return el as HTMLElement;
}

function arrowButton(btn: HTMLElement): HTMLElement {
    const el = btn.querySelector(".rsb-arrow-btn, .rsb-arrow-btn-small");
    expect(el).not.toBeNull();
    return el as HTMLElement;
}

describe("RibbonSplitButton", () => {
    afterEach(() => {
        CommandStore.unregisterCommand(CMD_A);
        CommandStore.unregisterCommand(CMD_B);
        document.body.querySelectorAll(".rsb-dropdown").forEach((el) => el.remove());
    });

    describe("rendering", () => {
        test("should render nothing when items are empty", () => {
            const btn = new RibbonSplitButton(makeSplitData([]), "large");
            expect(btn.childElementCount).toBe(0);
        });

        test("should render large split with main area and arrow button", () => {
            const btn = new RibbonSplitButton(
                makeSplitData([makePushButton(CMD_A, "icon-a", () => {})]),
                "large",
            );
            expect(btn.className).toBe("rsb-split");

            const main = mainArea(btn);
            const icon = main.querySelector("svg");
            expect(icon).not.toBeNull();
            expect(icon!.getAttribute("icon")).toBe("icon-a");
            expect(icon!.classList.contains("rb-icon")).toBe(true);

            const text = main.querySelector("label");
            expect(text).not.toBeNull();
            expect(text!.className).toBe("rsb-text");

            const arrow = arrowButton(btn).querySelector(".rsb-arrow");
            expect(arrow).not.toBeNull();
        });

        test("should render small split with small classes", () => {
            const btn = new RibbonSplitButton(
                makeSplitData([makePushButton(CMD_A, "icon-a", () => {})]),
                "small",
            );
            expect(btn.className).toBe("rsb-split-small");
            expect(btn.querySelector(".rsb-main-small")).not.toBeNull();
            expect(btn.querySelector(".rsb-arrow-btn-small")).not.toBeNull();
            const icon = btn.querySelector("svg");
            expect(icon).not.toBeNull();
            expect(icon!.classList.contains("rb-small-icon")).toBe(true);
        });

        test("should use first item icon and display as primary", () => {
            CommandStore.registerCommand(TestCommand, { key: CMD_A, icon: "icon-cmd-a" });
            const btn = new RibbonSplitButton(makeSplitData([CMD_A]), "large");
            const icon = mainArea(btn).querySelector("svg");
            expect(icon).not.toBeNull();
            expect(icon!.getAttribute("icon")).toBe("icon-cmd-a");
        });
    });

    describe("primary action", () => {
        test("should execute first item onClick when main area clicked", () => {
            const onClick = rs.fn(() => {});
            const btn = new RibbonSplitButton(
                makeSplitData([makePushButton(CMD_A, "icon-a", onClick)]),
                "large",
            );
            mainArea(btn).click();
            expect(onClick).toHaveBeenCalledTimes(1);
        });

        test("should publish executeCommand for string item when main area clicked", () => {
            CommandStore.registerCommand(TestCommand, { key: CMD_A, icon: "icon-cmd-a" });
            const published: string[] = [];
            const callback = (cmd: string) => published.push(cmd);
            PubSub.default.sub("executeCommand", callback);
            try {
                const btn = new RibbonSplitButton(makeSplitData([CMD_A]), "large");
                mainArea(btn).click();
                expect(published).toContain(CMD_A);
            } finally {
                PubSub.default.remove("executeCommand", callback);
            }
        });
    });

    describe("dropdown", () => {
        test("should open dropdown with all items when arrow clicked", () => {
            const btn = new RibbonSplitButton(
                makeSplitData([
                    makePushButton(CMD_A, "icon-a", () => {}),
                    makePushButton(CMD_B, "icon-b", () => {}),
                ]),
                "large",
            );
            document.body.appendChild(btn);
            try {
                arrowButton(btn).click();
                const dropdown = document.body.querySelector(".rsb-dropdown");
                expect(dropdown).not.toBeNull();
                expect(dropdown!.querySelectorAll(".rsb-dropdown-item").length).toBe(2);
            } finally {
                btn.dispose();
                btn.remove();
            }
        });

        test("should toggle dropdown closed on second arrow click", () => {
            const btn = new RibbonSplitButton(
                makeSplitData([makePushButton(CMD_A, "icon-a", () => {})]),
                "large",
            );
            document.body.appendChild(btn);
            try {
                const arrow = arrowButton(btn);
                arrow.click();
                expect(document.body.querySelector(".rsb-dropdown")).not.toBeNull();
                arrow.click();
                expect(document.body.querySelector(".rsb-dropdown")).toBeNull();
            } finally {
                btn.dispose();
                btn.remove();
            }
        });

        test("should switch primary action when dropdown item selected", () => {
            const onClickA = rs.fn(() => {});
            const onClickB = rs.fn(() => {});
            const btn = new RibbonSplitButton(
                makeSplitData([
                    makePushButton(CMD_A, "icon-a", onClickA),
                    makePushButton(CMD_B, "icon-b", onClickB),
                ]),
                "large",
            );
            document.body.appendChild(btn);
            try {
                arrowButton(btn).click();
                const items = document.body.querySelectorAll(".rsb-dropdown-item");
                expect(items.length).toBe(2);
                (items[1] as HTMLElement).click();

                // dropdown closed after selection
                expect(document.body.querySelector(".rsb-dropdown")).toBeNull();

                // primary icon switched to item B
                const icon = mainArea(btn).querySelector("svg");
                expect(icon).not.toBeNull();
                expect(icon!.getAttribute("icon")).toBe("icon-b");

                // main area now executes item B
                mainArea(btn).click();
                expect(onClickB).toHaveBeenCalledTimes(1);
                expect(onClickA).not.toHaveBeenCalled();
            } finally {
                btn.dispose();
                btn.remove();
            }
        });

        test("should keep primary unchanged when reselecting the current primary", () => {
            const onClickA = rs.fn(() => {});
            const btn = new RibbonSplitButton(
                makeSplitData([
                    makePushButton(CMD_A, "icon-a", onClickA),
                    makePushButton(CMD_B, "icon-b", () => {}),
                ]),
                "large",
            );
            document.body.appendChild(btn);
            try {
                arrowButton(btn).click();
                const items = document.body.querySelectorAll(".rsb-dropdown-item");
                (items[0] as HTMLElement).click();

                const icon = mainArea(btn).querySelector("svg");
                expect(icon).not.toBeNull();
                expect(icon!.getAttribute("icon")).toBe("icon-a");
            } finally {
                btn.dispose();
                btn.remove();
            }
        });
    });
});
