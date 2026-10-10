// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, PubSub } from "@chili3d/core";
import { breakEntity, breakPreview } from "../breakOps";
import { isClosedCurveType } from "../curveEval";
import type { SketchEditor, SketchEntityPick } from "../editor/sketchEditor";
import type { SketchPreviewAt } from "../previewTypes";
import { SketchConstraintCommand } from "./sketchConstraints";

/**
 * The break's hover cue, on the pick's own terms: the points the click would carve at.
 *
 * Once a closed curve's first point is in, every later hover previews the cut on *that*
 * entity, wherever the pointer happens to be — the second point is a position along the
 * closed curve, and insisting the pointer be over the thin curve itself would make it a
 * test of aim rather than of intent. The op projects it the same way.
 */
export function breakPreviewAt(editor: SketchEditor, first?: SketchEntityPick): SketchPreviewAt {
    return (entityId, uv) => {
        const target = first ?? { entityId, uv };
        const points = breakPreview(
            editor.solver,
            target.entityId,
            first === undefined ? [uv] : [first.uv, uv],
            editor.screenTolerance(),
        );
        return points.length === 0 ? undefined : { kind: "markers", uvs: points };
    };
}

/**
 * Carves a sketch curve in two at the click, leaving the two halves held together by a
 * coincidence — so the new point is a real vertex the sketch can be constrained by, not a
 * merely cosmetic seam.
 *
 * A line or an arc takes one click; a closed curve (a circle, an ellipse) takes two, because
 * it has no ends to cut from and a single cut would leave the same closed curve behind
 * (Onshape's rule for closed curves). The command stays active and commits each curve as it
 * lands, so a profile can be carved piece by piece and every one is its own undo step.
 */
@command({ key: "sketch.break", icon: "icon-break" })
export class SketchBreakCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        while (true) {
            this.beginStep();
            const first = await editor.pickEntityAt(
                "prompt.pickBreakEntity",
                undefined,
                { previewAt: breakPreviewAt(editor) },
                this.controller,
            );
            if (first === undefined) break;

            const uvs: [number, number][] = [first.uv];
            const pickedType = editor.solver.entity(first.entityId)?.type;
            if (pickedType !== undefined && isClosedCurveType(pickedType)) {
                const second = await this.pickSecondPoint(editor, first);
                if (second === undefined) break;
                uvs.push(second.uv);
            }
            this.applyBreak(editor, first.entityId, uvs);
        }
    }

    /** The closed curve's second point: the one that turns a seam into a cut. */
    private async pickSecondPoint(
        editor: SketchEditor,
        first: SketchEntityPick,
    ): Promise<SketchEntityPick | undefined> {
        this.beginStep();
        return editor.pickEntityAt(
            "prompt.pickBreakSecondPoint",
            undefined,
            { previewAt: breakPreviewAt(editor, first) },
            this.controller,
        );
    }

    /** Runs the op and commits, or reports why it would not. Either way the run carries on. */
    private applyBreak(editor: SketchEditor, entityId: number, uvs: readonly [number, number][]): void {
        const result = breakEntity(editor.solver, entityId, uvs, editor.screenTolerance());
        if (!result.isOk) {
            PubSub.default.pub("displayError", result.error);
            return;
        }
        // a circle retyped into an arc drops the constraints an arc cannot carry; a stale
        // anchor would be inherited by whichever constraint takes the id next (see the editor)
        editor.forgetConstraints(result.value.removedConstraints);
        if (result.value.removedConstraints.length > 0) {
            PubSub.default.pub(
                "statusBarTip",
                "sketch.breakRemovedConstraints{0}",
                result.value.removedConstraints.length,
            );
        }
        editor.solve(true);
        editor.commit();
    }
}
