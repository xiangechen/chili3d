// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, command, PubSub } from "@chili3d/core";
import type { SketchEditor } from "../editor/sketchEditor";
import { mirrorEntities, mirrorPreview } from "../mirrorOps";
import { ConstraintKind } from "../sketchModel";
import { allowsConstraintOnEntity } from "../solverEntities";
import { SketchConstraintCommand } from "./sketchConstraints";

/**
 * Reflects sketch entities across a picked line (or the X/Y datum axes), leaving copies
 * tied to their sources by symmetry constraints — move the line or edit a source and its
 * copy follows. The line is picked FIRST, then the geometry, which is the order Onshape
 * documents for the tool: click or rubber-band an entity and its copy lands on the spot,
 * and ESC ends the command keeping everything mirrored so far.
 *
 * A pre-existing selection skips the picking: the line pick previews the whole batch and
 * one commit mirrors it. With nothing selected the same preview moves to the picking
 * stage instead, where it shows what the entity under the cursor would leave.
 */
@command({ key: "sketch.mirror", icon: "icon-mirror" })
export class SketchMirrorCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        // read before the line pick even though it is consumed after it: the pick
        // previews the batch, so the batch has to be known while the pick is open
        const selected = editor.selectedEntityIds();

        this.controller = new AsyncController();
        const axisId = await editor.pickEntity(
            "prompt.pickMirrorAxis",
            "line",
            {
                datum: true,
                previewEntity: (entityId) =>
                    entityId === undefined
                        ? undefined
                        : mirrorPreview(editor.solver, selected, entityId, editor.screenTolerance()),
            },
            this.controller,
        );
        this.controller.dispose();
        if (axisId === undefined) return;
        // mirrors by a Symmetric constraint, so an external edge is no more usable here
        // than it is for `constraint.symmetric` (it reports why itself)
        if (!allowsConstraintOnEntity(ConstraintKind.Symmetric, axisId)) return;

        if (selected.length > 0) {
            this.applyMirror(editor, selected, axisId);
            // the highlight would keep claiming a selection the command consumed
            editor.clearEntitySelection();
            return;
        }
        await this.pickLoop(editor, axisId);
    }

    /**
     * Picks entities until ESC, mirroring each pick about the line as it lands — a click
     * yields one entity, a rubber-band box yields everything it crossed. Each round
     * commits on its own, so the mirror shows as it is picked and ESC leaves what is
     * already there (the same shape as `sketch.fillet` and `sketch.toggleConstruction`).
     */
    private async pickLoop(editor: SketchEditor, axisId: number): Promise<void> {
        while (true) {
            this.controller = new AsyncController();
            const picked = await editor.pickEntities(
                "prompt.pickMirrorSources",
                undefined,
                {
                    previewEntity: (entityId) =>
                        entityId === undefined
                            ? undefined
                            : mirrorPreview(editor.solver, [entityId], axisId, editor.screenTolerance()),
                },
                this.controller,
            );
            this.controller.dispose();
            if (picked === undefined || picked.length === 0) return;

            this.applyMirror(editor, picked, axisId);
            // a box leaves its catch highlighted; the click path selects nothing
            editor.clearEntitySelection();
        }
    }

    /** Mirrors `sources` about `axisId` and commits, reporting anything the op refused. */
    private applyMirror(editor: SketchEditor, sources: readonly number[], axisId: number): void {
        const result = mirrorEntities(editor.solver, sources, axisId, editor.screenTolerance());
        if (!result.isOk) {
            PubSub.default.pub("displayError", result.error);
            return;
        }
        const { createdEntityIds, skippedSelfMirror } = result.value;
        if (skippedSelfMirror.length > 0) {
            PubSub.default.pub("statusBarTip", "sketch.mirrorSkippedSelfMirror{0}", skippedSelfMirror.length);
        }
        // the op left the sketch alone — committing would only add an empty undo step
        if (createdEntityIds.length === 0) return;
        editor.solve(true);
        editor.commit();
    }
}
