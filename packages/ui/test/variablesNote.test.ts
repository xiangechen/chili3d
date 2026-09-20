// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// The description popup, driven by real events rather than the `_on*` fields. The marker's
// click is only half of what a browser does: the pointerdown that precedes it runs the row
// selection first, and that pair — selection, then the popup — is what this file exists to
// pin. The rest of the table's behaviour is in `variablesPanel.test.ts`, which uses the
// field-style mock; the two cannot share a file because the mock is registered per module.

import { type FloatPanelOptions, PubSub, type VariableData } from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { afterEach, expect, rs, test } from "@rstest/core";

import "./_helpers/cssMocks";
import "./_helpers/mockElementRealEvents";

rs.mock("../src/property/variables/variablesEditor.module.css", () => ({
    root: "v-root",
    table: "v-table",
    rows: "v-rows",
    row: "v-row",
    newRow: "v-new-row",
    header: "v-header",
    headerCell: "v-header-cell",
    cell: "v-cell",
    field: "v-field",
    value: "v-value",
    nameCell: "v-name-cell",
    marker: "v-marker",
    hasNote: "v-has-note",
    notePopup: "v-note-popup",
    noteInput: "v-note-input",
    error: "v-error",
    errorRow: "v-error-row",
    selected: "v-selected",
    resizer: "v-resizer",
    actions: "v-actions",
    iconButton: "v-icon-button",
    danger: "v-danger",
}));

import type { VariablesEditor } from "../src/property/variables/variablesEditor";
import { showVariablesPanel } from "../src/property/variables/variablesPanel";

describe("the description popup", () => {
    const opened: FloatPanelOptions[] = [];
    const capture = (options: FloatPanelOptions) => {
        opened.push(options);
    };

    afterEach(() => {
        PubSub.default.remove("showFloatPanel", capture);
        opened.length = 0;
        window.document.body.querySelector(".v-note-input")?.remove();
    });

    function open(items: VariableData[]) {
        const document = new TestDocument();
        document.history.disabled = true;
        document.variables.setItems(items);
        document.history.disabled = false;

        PubSub.default.sub("showFloatPanel", capture);
        showVariablesPanel(document, () => {});
        return { document, editor: opened[0]?.content as VariablesEditor };
    }

    test("clicking the row's marker adds a description", () => {
        const { document, editor } = open([{ id: "v1", name: "w", type: "length", expression: "50" }]);
        const marker = editor.querySelector(".v-marker") as HTMLElement;
        expect(marker).not.toBeNull();

        // A real click is the pair: the row is selected on the way down, the popup opens on
        // the way up. Selecting rebuilds the title bar, so the wrong order would lose the click.
        marker.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        expect((opened[0].actions?.[0] as HTMLElement).childElementCount).toBe(3);

        marker.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        const box = window.document.body.querySelector(".v-note-input") as HTMLInputElement;
        expect(box).not.toBeNull();
        box.value = "总宽";
        box.dispatchEvent(new FocusEvent("blur"));

        expect(document.variables.items[0].description).toBe("总宽");
        expect(window.document.body.querySelector(".v-note-input")).toBeNull();
    });
});
