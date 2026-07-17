// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys, PushButton } from "@chili3d/core";
import { CommandStore, PubSub } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { createDropdownItem, DropdownController, getItemData } from "../src/ribbon/dropdownController";

function makePushButton(overrides: Partial<PushButton> & { command: CommandKeys }): PushButton {
    return {
        type: "push",
        size: "large",
        icon: "icon-command",
        onClick: () => {},
        ...overrides,
    } as PushButton;
}

describe("getItemData", () => {
    describe("with string key (CommandKeys)", () => {
        test("should return command data from CommandStore when available", () => {
            const result = getItemData("doc.save");
            expect(result.command).toBe("doc.save");
            expect(result.icon).toBeDefined();
            expect(result.display).toBeDefined();
            expect(typeof result.onClick).toBe("function");
        });

        test("should fallback to default icon when CommandStore returns no data", () => {
            // Use a string that can be passed as CommandKeys — ts-ignore because the literal
            // isn't in the union, but we test the runtime fallback
            // biome-ignore lint/suspicious/noExplicitAny: testing runtime fallback for unknown command key
            const result = getItemData("unknown.command" as any);
            expect(result.command).toBe("unknown.command");
            expect(result.icon).toBe("icon-command");
            expect(result.display).toBe("unknown.command");
        });

        test("should create onClick that publishes executeCommand event", () => {
            const published: string[] = [];
            const callback = (cmd: string) => published.push(cmd);
            PubSub.default.sub("executeCommand", callback);

            const result = getItemData("doc.save");
            result.onClick();

            PubSub.default.remove("executeCommand", callback);
            expect(published).toContain("doc.save");
        });
    });

    describe("with PushButton object", () => {
        test("should extract command, icon, display from object", () => {
            const onClick = () => {};
            const result = getItemData(
                makePushButton({
                    command: "doc.saveToFile",
                    icon: "icon-save",
                    display: "Save File" as unknown as PushButton["display"],
                    onClick,
                }),
            );

            expect(result.command).toBe("doc.saveToFile");
            expect(result.icon).toBe("icon-save");
            expect(result.display).toBe("Save File");
            expect(result.onClick).toBe(onClick);
        });

        test("should generate display from command when display is not provided", () => {
            const result = getItemData(makePushButton({ command: "doc.save", icon: "icon-save" }));

            expect(result.display).toBe("command.doc.save");
        });
    });
});

describe("createDropdownItem", () => {
    const classes = {
        item: "dropdown-item",
        icon: "dropdown-icon",
        text: "dropdown-text",
    };

    test("should create an element with the item class", () => {
        const item = createDropdownItem("doc.save", () => {}, classes);
        expect(item.className).toBe(classes.item);
    });

    test("should contain icon and text child elements", () => {
        const item = createDropdownItem(
            makePushButton({ command: "doc.save", icon: "icon-save" }),
            () => {},
            classes,
        );
        const icon = item.querySelector(`.${classes.icon}`);
        const text = item.querySelector(`.${classes.text}`);
        expect(icon).not.toBeNull();
        expect(text).not.toBeNull();
    });

    test("should publish executeCommand and call onSelect when clicked", () => {
        const calls: string[] = [];
        const callback = (cmd: string) => calls.push(`cmd:${cmd}`);
        PubSub.default.sub("executeCommand", callback);

        const item = createDropdownItem("doc.save", () => calls.push("select"), classes);
        (item as HTMLElement).click();

        PubSub.default.remove("executeCommand", callback);
        expect(calls).toContain("cmd:doc.save");
        expect(calls).toContain("select");
    });
});

describe("DropdownController", () => {
    let controller: DropdownController;

    beforeEach(() => {
        controller = new DropdownController("test-dropdown");
    });

    afterEach(() => {
        controller.dispose();
        // Clean up any leftover dropdowns in the DOM
        document.body.querySelectorAll(".test-dropdown").forEach((el) => el.remove());
    });

    describe("initial state", () => {
        test("should start in closed state", () => {
            expect(controller.isOpened).toBe(false);
        });

        test("should not be in the openedDropdowns set", () => {
            expect(DropdownController.openedDropdowns.has(controller)).toBe(false);
        });
    });

    describe("open", () => {
        test("should set isOpened to true", () => {
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            controller.open(anchor, () => {});
            expect(controller.isOpened).toBe(true);
            anchor.remove();
        });

        test("should append dropdown to document.body", () => {
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            controller.open(anchor, () => {});
            const dropdown = document.body.querySelector(".test-dropdown");
            expect(dropdown).not.toBeNull();
            anchor.remove();
        });

        test("should add controller to openedDropdowns set", () => {
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            controller.open(anchor, () => {});
            expect(DropdownController.openedDropdowns.has(controller)).toBe(true);
            anchor.remove();
        });

        test("should call buildItems callback", () => {
            let called = false;
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            controller.open(anchor, (dropdown) => {
                called = true;
                expect(dropdown).not.toBeNull();
            });
            expect(called).toBe(true);
            anchor.remove();
        });

        test("should be idempotent — second open call does nothing", () => {
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            controller.open(anchor, () => {});
            controller.open(anchor, () => {
                throw new Error("buildItems should not be called again");
            });
            expect(controller.isOpened).toBe(true);
            anchor.remove();
        });

        test("should close other opened dropdowns before opening", () => {
            const other = new DropdownController("other-dropdown");
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            other.open(anchor, () => {});
            expect(other.isOpened).toBe(true);

            controller.open(anchor, () => {});
            expect(other.isOpened).toBe(false);
            expect(controller.isOpened).toBe(true);

            anchor.remove();
            other.dispose();
        });
    });

    describe("close", () => {
        test("should set isOpened to false", () => {
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            controller.open(anchor, () => {});
            controller.close();
            expect(controller.isOpened).toBe(false);
            anchor.remove();
        });

        test("should remove dropdown from DOM", () => {
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            controller.open(anchor, () => {});
            controller.close();
            const dropdown = document.body.querySelector(".test-dropdown");
            expect(dropdown).toBeNull();
            anchor.remove();
        });

        test("should remove controller from openedDropdowns set", () => {
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            controller.open(anchor, () => {});
            controller.close();
            expect(DropdownController.openedDropdowns.has(controller)).toBe(false);
            anchor.remove();
        });

        test("should be idempotent — closing twice does not throw", () => {
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);
            controller.open(anchor, () => {});
            controller.close();
            expect(() => controller.close()).not.toThrow();
            anchor.remove();
        });
    });

    describe("closeAll (static)", () => {
        test("should close all opened dropdowns", () => {
            const c1 = new DropdownController("d1");
            const c2 = new DropdownController("d2");
            const anchor = document.createElement("div");
            document.body.appendChild(anchor);

            c1.open(anchor, () => {});
            c2.open(anchor, () => {}); // this closes c1 first
            c1.open(anchor, () => {}); // reopen c1, closes c2
            c2.open(anchor, () => {}); // reopen c2, closes c1

            // At this point only c2 is open
            DropdownController.closeAll();

            expect(c1.isOpened).toBe(false);
            expect(c2.isOpened).toBe(false);

            anchor.remove();
            c1.dispose();
            c2.dispose();
        });
    });
});
