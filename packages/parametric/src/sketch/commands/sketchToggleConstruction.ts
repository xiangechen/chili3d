// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, command, PubSub } from "@chili3d/core";
import type { SketchEditor } from "../editor/sketchEditor";
import { isDatumEntityId, isExternalEntityId } from "../sketchModel";
import { SketchConstraintCommand } from "./sketchConstraints";

/**
 * Flips entities between profile and construction geometry — construction entities
 * stay constraint/snap targets (drawn dashed) but never join profile building. A
 * pre-existing session selection is flipped in one commit; with nothing selected
 * the command picks in a loop until ESC. Every flip commits right away: the flag
 * steers shape building, and only a commit re-evaluates the shape — a line flipped
 * back to profile geometry would otherwise be drawn by neither the node shape nor
 * the construction overlay until the command ended. External references have their
 * own role toggle (`sketch.toggleExternal`) and are skipped.
 */
@command({ key: "sketch.toggleConstruction", icon: "icon-toggleConstruction" })
export class ToggleSketchConstruction extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        // a pre-existing selection is the target — flip it in one commit and finish
        const selected = editor
            .selectedEntityIds()
            .filter((id) => !isDatumEntityId(id) && !isExternalEntityId(id));
        if (selected.length > 0) {
            for (const id of selected) {
                editor.solver.setConstruction(id, !editor.solver.isConstruction(id));
            }
            // the solid selection highlight would hide the dashed style just adopted
            editor.clearEntitySelection();
            editor.commit();
            return;
        }
        while (true) {
            this.controller = new AsyncController();
            const id = await editor.pickEntity(
                "prompt.pickConstructionEntity",
                undefined,
                undefined,
                this.controller,
            );
            this.controller.dispose();
            if (id === undefined) break;
            if (isDatumEntityId(id) || isExternalEntityId(id)) {
                PubSub.default.pub("statusBarTip", "prompt.pickConstructionEntity");
                continue;
            }
            // geometry is untouched — the flag only steers shape building and rendering;
            // commit also re-renders the overlays (SketchEditor.commit)
            editor.solver.setConstruction(id, !editor.solver.isConstruction(id));
            editor.commit();
        }
    }
}
