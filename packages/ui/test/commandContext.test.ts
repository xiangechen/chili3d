// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { AsyncController, I18nKeys, Locale, ParameterValue } from "@chili3d/core";
import {
    Combobox,
    CommandStore,
    I18n,
    LENGTH_UNITS,
    Observable,
    PropertyUtils,
    PubSub,
    property,
} from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";

// CSS module under test
rs.mock("../src/ribbon/commandContext.module.css", () => ({
    panel: "cc-panel",
    container: "cc-container",
    command: "cc-command",
    icon: "cc-icon",
    title: "cc-title",
    cancelButton: "cc-cancel",
    selectionButton: "cc-selection-button",
    selectionControl: "cc-selection-control",
    selectionInfo: "cc-selection-info",
    selectionCount: "cc-selection-count",
    selectionCountLabel: "cc-selection-count-label",
    group: "cc-group",
    select: "cc-select",
    input: "cc-input",
    button: "cc-button",
    materialButton: "cc-material-button",
}));

// Mock element helpers
import "./_helpers/mockElement";

import { CommandContext } from "../src/ribbon/commandContext";
import { mustQuery } from "./_helpers/domHelpers";

const CMD_KEY = "test.context.command";
const CANCEL_CMD_KEY = "test.context.cancelable";
const MATERIAL_CMD_KEY = "test.context.material";
const LENGTH_CMD_KEY = "test.context.length";

class TestCommand extends Observable {
    async execute() {}

    private _flag = false;
    @property("test.flag" as I18nKeys)
    get flag() {
        return this._flag;
    }
    set flag(value: boolean) {
        this._flag = value;
    }

    private _size = 1;
    @property("test.size" as I18nKeys)
    get size() {
        return this._size;
    }
    set size(value: number) {
        this._size = value;
    }

    private _name = "abc";
    @property("test.name" as I18nKeys)
    get name() {
        return this._name;
    }
    set name(value: string) {
        this._name = value;
    }

    private _mode = "a";
    @property("test.mode" as I18nKeys)
    get mode() {
        return this._mode;
    }
    set mode(value: string) {
        this.setProperty("mode", value);
    }

    private _detail = 1;
    @property("test.detail" as I18nKeys, { dependencies: [{ property: "mode", value: "b" }] })
    get detail() {
        return this._detail;
    }
    set detail(value: number) {
        this._detail = value;
    }

    choice = "x";
    @property("test.choice" as I18nKeys, {
        combobox: Combobox.from(["x", "y"]),
    })
    get choiceProp() {
        return this.choice;
    }
    set choiceProp(value: string) {
        this.choice = value;
    }

    actionCalled = 0;
    @property("test.action" as I18nKeys)
    action() {
        this.actionCalled++;
    }
}

class CancelableTestCommand extends Observable {
    async execute() {}
    cancel = rs.fn(async () => {});
}

/** A command whose field is a dimensional one, so expressions are accepted there. */
class LengthCommand extends Observable {
    readonly document = new TestDocument();

    private _depth: ParameterValue = 0;
    @property("test.depth" as I18nKeys, { unit: LENGTH_UNITS })
    get depth(): ParameterValue {
        return this._depth;
    }
    set depth(value: ParameterValue) {
        this._depth = value;
    }

    async execute() {}
}

class MaterialCommand extends Observable {
    async execute() {}
    private _materialId = "m1";
    @property("test.material" as I18nKeys, { type: "materialId" })
    get materialId() {
        return this._materialId;
    }
    set materialId(value: string) {
        this._materialId = value;
    }
}

function findInput(ctx: CommandContext, type: string): HTMLInputElement {
    return mustQuery(ctx, `input[type='${type}']`);
}

describe("CommandContext", () => {
    let contexts: CommandContext[];

    beforeEach(() => {
        contexts = [];
        CommandStore.registerCommand(TestCommand, { key: CMD_KEY, icon: "icon-ctx" });
        CommandStore.registerCommand(CancelableTestCommand, { key: CANCEL_CMD_KEY, icon: "icon-ctx" });
        CommandStore.registerCommand(MaterialCommand, { key: MATERIAL_CMD_KEY, icon: "icon-ctx" });
        CommandStore.registerCommand(LengthCommand, { key: LENGTH_CMD_KEY, icon: "icon-ctx" });
        // I18n.isI18nKey (used by the combobox editor) reads the zh-CN translation table
        I18n.addLanguage({ display: "zh", language: "zh-CN", translation: {} as Locale["translation"] });
    });

    afterEach(() => {
        contexts.forEach((c) => {
            c.remove();
            c.dispose();
        });
        CommandStore.unregisterCommand(CMD_KEY);
        CommandStore.unregisterCommand(CANCEL_CMD_KEY);
        CommandStore.unregisterCommand(MATERIAL_CMD_KEY);
        CommandStore.unregisterCommand(LENGTH_CMD_KEY);
        I18n.removeLanguage("zh-CN");
    });

    function track(ctx: CommandContext): CommandContext {
        contexts.push(ctx);
        return ctx;
    }

    describe("header", () => {
        test("should render command icon and title", () => {
            const ctx = track(new CommandContext(new TestCommand()));
            expect(ctx.className).toBe("cc-panel");

            const header = mustQuery(ctx, ".cc-command");

            const icon = mustQuery(header, "svg");
            expect(icon.getAttribute("icon")).toBe("icon-ctx");
            expect(icon.classList.contains("cc-icon")).toBe(true);

            mustQuery(header, ".cc-title");
        });

        test("should not render cancel button for non-cancelable command", () => {
            const ctx = track(new CommandContext(new TestCommand()));
            expect(ctx.querySelector(".cc-cancel")).toBeNull();
        });
    });

    describe("dimensional fields", () => {
        function dimensionalContext(
            variables: { name: string; expression: string; type?: "length" | "angle" }[],
        ) {
            const command = new LengthCommand();
            command.document.variables.setItems(
                variables.map((x, index) => ({
                    id: `v${index}`,
                    name: x.name,
                    expression: x.expression,
                    type: x.type ?? "length",
                })),
            );
            const ctx = track(new CommandContext(command));
            const input = mustQuery<HTMLInputElement>(ctx, "input[type='text']");
            return {
                command,
                input,
                type: (value: string) => {
                    // The real element is the target: a refusal is supposed to put the field
                    // back to the command's own value, and that is only observable here.
                    input.value = value;
                    (input as unknown as { _onblur: (e: { target: HTMLInputElement }) => void })._onblur({
                        target: input,
                    });
                },
            };
        }

        test("stores a parameter name as written, not what it resolves to", () => {
            const { command, type } = dimensionalContext([{ name: "w", expression: "50" }]);

            type("w * 2");

            // The relation is what a feature keeps — that is what lets a later edit to `w`
            // carry through instead of freezing today's number.
            expect(command.depth).toBe("w * 2");
        });

        test("stores a plain number as a number", () => {
            const { command, type } = dimensionalContext([]);

            type("25");

            expect(command.depth).toBe(25);
        });

        test("refuses an expression the parameters cannot resolve", () => {
            const { command, type } = dimensionalContext([]);

            type("nope");

            expect(command.depth).toBe(0);
        });

        test("refuses a value of the wrong dimension", () => {
            const { command, type } = dimensionalContext([{ name: "a", expression: "45", type: "angle" }]);

            type("a");

            expect(command.depth).toBe(0);
        });

        // A field left showing text the command refused is a lie the user confirms against:
        // nothing re-renders the binding (a plain setter emits no property change), so the
        // refusal has to put the value back itself.
        test.each([
            { value: "nope", variables: [] as { name: string; expression: string; type?: "angle" }[] },
            { value: "a", variables: [{ name: "a", expression: "45", type: "angle" as const }] },
        ])("a refused `$value` does not stay in the field", ({ value, variables }) => {
            const { command, input, type } = dimensionalContext(variables);

            type(value);

            expect(command.depth).toBe(0);
            expect(input.value).toBe("0");
        });

        test("an accepted expression is what the field goes on showing", () => {
            const { input, type } = dimensionalContext([{ name: "w", expression: "50" }]);

            type("w * 2");

            expect(input.value).toBe("w * 2");
        });
    });

    describe("property controls", () => {
        test("boolean property should render checkbox that toggles the property", () => {
            const command = new TestCommand();
            const ctx = track(new CommandContext(command));
            const checkbox = findInput(ctx, "checkbox");
            expect(command.flag).toBe(false);

            (checkbox as unknown as { _onclick: () => void })._onclick();
            expect(command.flag).toBe(true);

            (checkbox as unknown as { _onclick: () => void })._onclick();
            expect(command.flag).toBe(false);
        });

        test("number property should render text input that parses on blur", () => {
            const command = new TestCommand();
            const ctx = track(new CommandContext(command));
            const inputs = ctx.querySelectorAll("input[type='text']");
            expect(inputs.length).toBeGreaterThan(0);
            // first text input is the number property (declared before the string one)
            const input = inputs[0] as HTMLInputElement;
            (input as unknown as { _onblur: (e: { target: { value: string } }) => void })._onblur({
                target: { value: "3.5" },
            });
            expect(command.size).toBe(3.5);
        });

        test("string property should render text input that assigns on blur", () => {
            const command = new TestCommand();
            const ctx = track(new CommandContext(command));
            const inputs = ctx.querySelectorAll("input[type='text']");
            const input = inputs[1] as HTMLInputElement;
            (input as unknown as { _onblur: (e: { target: { value: string } }) => void })._onblur({
                target: { value: "hello" },
            });
            expect(command.name).toBe("hello");
        });

        test("function property should render button that invokes the method", () => {
            const command = new TestCommand();
            const ctx = track(new CommandContext(command));
            const button = mustQuery(ctx, "button");

            (button as unknown as { _onclick: () => void })._onclick();
            expect(command.actionCalled).toBe(1);
        });

        test("combobox property should render select and assign selected item on change", () => {
            const command = new TestCommand();
            const ctx = track(new CommandContext(command));
            const select = mustQuery<HTMLSelectElement>(ctx, "select");
            expect(select.querySelectorAll("option").length).toBe(2);

            (
                select as unknown as { _onchange: (e: { target: { selectedIndex: number } }) => void }
            )._onchange({
                target: { selectedIndex: 1 },
            });
            expect(command.choice).toBe("y");
        });

        test("combobox selection should follow the command property value, not the shared combobox state", () => {
            const combobox = PropertyUtils.getProperty(TestCommand.prototype, "choiceProp")!.combobox!;
            const originalIndex = combobox.selectedIndex;
            try {
                // Stale shared state left over from a previous execution must not win over
                // the command property value (default "x").
                combobox.selectedIndex = 1;
                const ctx1 = track(new CommandContext(new TestCommand()));
                const options1 = mustQuery<HTMLSelectElement>(ctx1, "select").querySelectorAll("option");
                expect((options1[0] as any)._selected).toBe(true);
                expect((options1[1] as any)._selected).toBe(false);

                combobox.selectedIndex = 0;
                const command = new TestCommand();
                command.choice = "y";
                const ctx2 = track(new CommandContext(command));
                const options2 = mustQuery<HTMLSelectElement>(ctx2, "select").querySelectorAll("option");
                expect((options2[0] as any)._selected).toBe(false);
                expect((options2[1] as any)._selected).toBe(true);
            } finally {
                combobox.selectedIndex = originalIndex;
            }
        });
    });

    describe("dependent property visibility", () => {
        test("should hide dependent property until dependency matches, then reveal on change", () => {
            const command = new TestCommand();
            const ctx = track(new CommandContext(command));
            document.body.appendChild(ctx);

            // detail depends on mode === "b"; mode starts as "a" so detail is hidden.
            // The detail control is the text input inside the second group — locate it
            // via the property order: detail input is the last text input.
            const inputs = ctx.querySelectorAll("input[type='text']");
            const detailInput = inputs[inputs.length - 1] as HTMLInputElement;
            const detailControl = detailInput.parentElement as HTMLElement;
            expect(detailControl).not.toBeNull();
            expect(detailControl.style.display).toBe("none");

            command.mode = "b";
            expect(detailControl.style.display).toBe("inherit");

            command.mode = "a";
            expect(detailControl.style.display).toBe("none");
        });
    });

    describe("cancelable command", () => {
        test("should render cancel button that calls command.cancel", () => {
            const command = new CancelableTestCommand();
            const ctx = track(new CommandContext(command));
            const cancelButton = mustQuery(ctx, ".cc-cancel .cc-selection-button");

            (cancelButton as unknown as { _onclick: () => void })._onclick();
            expect(command.cancel).toHaveBeenCalledTimes(1);
        });
    });

    describe("selection control", () => {
        test("should show selection control on pubsub event and call controller on confirm", () => {
            const command = new CancelableTestCommand();
            const ctx = track(new CommandContext(command));
            document.body.appendChild(ctx);

            const controller = { success: rs.fn(() => {}), cancel: rs.fn(() => {}) };
            PubSub.default.pub("showSelectionControl", controller as unknown as AsyncController);

            const control = ctx.querySelector(".cc-selection-control");
            expect(control).not.toBeNull();
            // close icon hidden while selection control is shown
            const closeIcon = mustQuery(ctx, ".cc-cancel");
            expect(closeIcon.style.display).toBe("none");

            const buttons = control!.querySelectorAll(".cc-selection-button");
            expect(buttons.length).toBe(2);
            (buttons[0] as unknown as { _onclick: () => void })._onclick();
            expect(controller.success).toHaveBeenCalledTimes(1);

            PubSub.default.pub("clearSelectionControl");
            expect(ctx.querySelector(".cc-selection-control")).toBeNull();
            expect(closeIcon.style.display).toBe("");
        });

        test("should call controller.cancel on cancel button click", () => {
            const command = new CancelableTestCommand();
            const ctx = track(new CommandContext(command));
            document.body.appendChild(ctx);

            const controller = { success: rs.fn(() => {}), cancel: rs.fn(() => {}) };
            PubSub.default.pub("showSelectionControl", controller as unknown as AsyncController);

            const buttons = ctx.querySelectorAll(".cc-selection-control .cc-selection-button");
            expect(buttons.length).toBe(2);
            (buttons[1] as unknown as { _onclick: () => void })._onclick();
            expect(controller.cancel).toHaveBeenCalledTimes(1);

            PubSub.default.pub("clearSelectionControl");
        });
    });

    describe("material property", () => {
        test("should throw for materialId property on non-cancelable command", () => {
            expect(() => new CommandContext(new MaterialCommand())).toThrow(
                "MaterialEditor only support CancelableCommand",
            );
        });
    });
});
