// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, PubSub } from "@chili3d/core";
import { VariablesDataContent } from "./variablesDataContent";
import { VariablesEditor } from "./variablesEditor";

/**
 * The parameters panel — a floating window rather than the modal dialog this started as.
 *
 * The point of editing parameters is watching the geometry follow, and a modal covers the
 * viewport that shows it. So the edits land as they are made (see `VariablesDataContent`) and
 * there is no confirm button: closing the panel is not a decision, it is just putting it away.
 *
 * The panel is bound to its document (see `FloatPanelOptions.document`) because it writes
 * straight through to the parameter table: closing the document disposes that table, and a
 * panel left up would throw out of its next edit.
 */
export function showVariablesPanel(document: IDocument, onApplied: () => void): void {
    PubSub.default.pub("showFloatPanel", {
        title: "variables.title",
        content: new VariablesEditor(new VariablesDataContent(document, onApplied)),
        width: 560,
        height: 360,
        minWidth: 420,
        minHeight: 200,
        document,
    });
}
