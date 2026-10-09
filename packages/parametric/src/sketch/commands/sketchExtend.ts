// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, PubSub, property } from "@chili3d/core";
import type { SketchEditor, SketchEntityPick } from "../editor/sketchEditor";
import { type ExtendOptions, extendEntity, extendPreview } from "../extendOps";
import type { SketchPreviewAt } from "../previewTypes";
import { SketchConstraintCommand } from "./sketchConstraints";

/**
 * The extend's hover cue, on the pick's own terms: the spans the click would change — the
 * target's, and the boundary's when it moves too — or nothing where the two would not meet.
 * The target is the pick that came before, so the cue and the op read the same two entities
 * and cannot propose different corners.
 */
export function extendPreviewAt(
    editor: SketchEditor,
    target: SketchEntityPick,
    modifyBoundary: boolean,
): SketchPreviewAt {
    return (entityId, uv) => {
        const pieces = extendPreview(editor.solver, {
            targetId: target.entityId,
            targetUv: target.uv,
            boundaryId: entityId,
            boundaryUv: uv,
            modifyBoundary,
            tolerance: editor.screenTolerance(),
        });
        return pieces === undefined ? undefined : { kind: "pieces", pieces };
    };
}

/**
 * Prolongs a sketch curve until it meets a boundary the user picks: the target's end nearer
 * the click walks out along its own support curve to the corner the two share, and the new
 * endpoint is pinned there. Two steps, like `modify.extend` — a target can have any number
 * of crossings out there, and only the user knows which one was meant.
 *
 * `modifyBoundary` brings the boundary's own end to the corner as well, so "make these two
 * meet" is one gesture. The command stays active and commits each corner as it lands, so a
 * profile can be closed corner by corner and every one is its own undo step (the shape the
 * trim and `sketch.toggleConstruction` have).
 */
@command({ key: "sketch.extend", icon: "icon-extend" })
export class SketchExtendCommand extends SketchConstraintCommand {
    /** Whether the boundary is also brought to the corner (or cut back to it). */
    @property("option.command.modifyBoundary")
    get modifyBoundary(): boolean {
        return this.getPrivateValue("modifyBoundary", true);
    }
    set modifyBoundary(value: boolean) {
        this.setProperty("modifyBoundary", value);
    }

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        while (true) {
            this.beginStep();
            const target = await editor.pickEntityAt(
                "prompt.pickExtendTarget",
                // an offset copy is a curve with ends like any other, though what moves when one
                // of them does is the window it is drawn over rather than a point (see `extendOps`)
                ["line", "arc", "ellipseArc", "conic", "bezier", "nurbs", "offsetCurve"],
                undefined,
                this.controller,
            );
            if (target === undefined) break;

            this.beginStep();
            const boundary = await editor.pickEntityAt(
                "prompt.pickExtendBoundary",
                undefined,
                // the datum axes count as a boundary: running a line out to the X axis is
                // the same gesture as running it out to a drawn line
                { datum: true, previewAt: extendPreviewAt(editor, target, this.modifyBoundary) },
                this.controller,
            );
            if (boundary === undefined) break;

            this.applyExtend(editor, target, boundary);
        }
    }

    /** Runs the op and commits, or reports why it would not. Either way the run carries on. */
    private applyExtend(editor: SketchEditor, target: SketchEntityPick, boundary: SketchEntityPick): void {
        const result = extendEntity(editor.solver, this.optionsOf(editor, target, boundary));
        if (!result.isOk) {
            PubSub.default.pub("displayError", result.error);
            return;
        }
        // the extend removed these behind the editor's back; a stale anchor would be
        // inherited by whichever constraint takes the id next (see the editor)
        editor.forgetConstraints(result.value.removedConstraints);
        if (result.value.removedConstraints.length > 0) {
            PubSub.default.pub(
                "statusBarTip",
                "sketch.extendRemovedConstraints{0}",
                result.value.removedConstraints.length,
            );
        }
        editor.solve(true);
        editor.commit();
    }

    private optionsOf(
        editor: SketchEditor,
        target: SketchEntityPick,
        boundary: SketchEntityPick,
    ): ExtendOptions {
        return {
            targetId: target.entityId,
            targetUv: target.uv,
            boundaryId: boundary.entityId,
            boundaryUv: boundary.uv,
            modifyBoundary: this.modifyBoundary,
            tolerance: editor.screenTolerance(),
        };
    }
}
