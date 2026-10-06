// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, command, PubSub } from "@chili3d/core";
import type { SketchEditor } from "../editor/sketchEditor";
import type { SketchPreviewAt } from "../previewTypes";
import { trimEntity, trimPreview } from "../trimOps";
import { SketchConstraintCommand } from "./sketchConstraints";

/**
 * The trim's hover cue, on the pick's own terms: the piece the click would remove, or
 * nothing where the trim would refuse — which is how the refusal reads before the click
 * rather than after it.
 */
export function trimPreviewAt(editor: SketchEditor): SketchPreviewAt {
    return (entityId, uv) => {
        const piece = trimPreview(editor.solver, entityId, uv, editor.screenTolerance());
        return piece === undefined ? undefined : { kind: "pieces", pieces: [{ piece, role: "remove" }] };
    };
}

/**
 * Cuts away the piece of a sketch entity under the cursor — the span between the two
 * crossings nearest the click, so what goes is bounded by real geometry rather than by
 * where the click happened to land. The command stays active and commits each piece as
 * it lands, so a profile can be trimmed piece by piece and every one of them is its own
 * undo step (the same shape as `sketch.toggleConstruction`).
 *
 * The click position is what picks the piece, so a pre-existing selection is no use
 * here: a box has no position, and the entities it caught are the whole point of
 * leaving them alone until the user clicks.
 */
@command({ key: "sketch.trim", icon: "icon-trim" })
export class SketchTrimCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        while (true) {
            this.controller = new AsyncController();
            const pick = await editor.pickEntityAt(
                "prompt.pickTrimEntity",
                undefined,
                { previewAt: trimPreviewAt(editor) },
                this.controller,
            );
            this.controller.dispose();
            if (pick === undefined) break;

            const result = trimEntity(editor.solver, pick.entityId, pick.uv, editor.screenTolerance());
            if (!result.isOk) {
                PubSub.default.pub("displayError", result.error);
                continue;
            }
            // the trim removed these behind the editor's back; a stale anchor would be
            // inherited by whichever constraint takes the id next (see the editor)
            editor.forgetConstraints(result.value.removedConstraints);
            if (result.value.removedConstraints.length > 0) {
                PubSub.default.pub(
                    "statusBarTip",
                    "sketch.trimRemovedConstraints{0}",
                    result.value.removedConstraints.length,
                );
            }
            editor.solve(true);
            editor.commit();
        }
    }
}
