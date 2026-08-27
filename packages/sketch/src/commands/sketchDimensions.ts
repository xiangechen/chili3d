// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command } from "@chili3d/core";
import { type DimensionAnchor, segmentOffset } from "../editor/dimensionLayout";
import type { SketchEditor } from "../editor/sketchEditor";
import { ConstraintKind, pointRefKey, type SketchConstraintData, type SketchPointRef } from "../sketchModel";
import type { SketchSolver } from "../solver";
import { SketchConstraintCommand } from "./sketchConstraints";

@command({ key: "dimension.distance", icon: "icon-measureLength" })
export class DistanceDimensionCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const p1 = await editor.pickPoint("prompt.pickSketchPoint");
        if (p1 === undefined) return;

        // rubber-band line from the first point to the cursor while picking the second
        const uv1 = editor.solver.pointOf(p1);
        const p2 = await pickWithPreview(editor, () =>
            editor.pickPoint("prompt.pickSketchPoint", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined ? undefined : { kind: "segment", p1: uv1, p2: uv },
                ),
            ),
        );
        if (p2 === undefined) return;

        const uv2 = editor.solver.pointOf(p2);
        const position = await pickWithPreview(editor, () =>
            editor.pickPosition("prompt.pickDimensionPosition", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined ? undefined : { kind: "distance", p1: uv1, p2: uv2, position: uv },
                ),
            ),
        );
        if (position === undefined) return;

        // anchor the label relative to the segment so it follows the geometry
        const offset = segmentOffset(uv1, uv2, position);
        const initial = currentDistance(editor.solver, p1, p2);
        commitDimension(
            editor,
            {
                kind: ConstraintKind.P2PDistance,
                refs: normalizeLineRefs(editor.solver, p1, p2),
                datum: initial,
            },
            { kind: "offset", offset },
            initial,
        );
    }
}

@command({ key: "dimension.radius", icon: "icon-circle" })
export class RadiusDimensionCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const circleId = await editor.pickEntity("prompt.pickSketchEntity", "circle");
        if (circleId === undefined) return;

        const circle = editor.solver.entity(circleId)!;
        const center: [number, number] = [circle.params[0], circle.params[1]];
        const position = await pickWithPreview(editor, () =>
            editor.pickPosition("prompt.pickDimensionPosition", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined
                        ? undefined
                        : { kind: "radius", center, radius: circle.params[2], position: uv },
                ),
            ),
        );
        if (position === undefined) return;

        // anchor the label as a vector from the center so it follows the circle
        commitDimension(
            editor,
            {
                kind: ConstraintKind.Radius,
                refs: [{ entityId: circleId, pointIndex: 0 }],
                datum: circle.params[2],
            },
            { kind: "vector", dx: position[0] - center[0], dy: position[1] - center[1] },
            circle.params[2],
        );
    }
}

/** Runs a pick with a live dimension preview, always clearing the preview afterwards. */
async function pickWithPreview<T>(
    editor: SketchEditor,
    pick: () => Promise<T | undefined>,
): Promise<T | undefined> {
    try {
        return await pick();
    } finally {
        editor.annotations.setDimensionPreview(undefined);
    }
}

/**
 * Creates the constraint right away so the dimension stays visible while the
 * input is open, but commits only on confirm — creation + datum land in a
 * single undo step; cancelling rolls the constraint back from the solver.
 */
function commitDimension(
    editor: SketchEditor,
    constraint: Omit<SketchConstraintData, "id">,
    anchor: DimensionAnchor,
    initial: number,
): void {
    const id = editor.solver.addConstraint(constraint);
    editor.dimensionAnchors.set(id, anchor);
    editor.solve(true);
    editor.promptDatum(
        initial,
        (value) => editor.solver.setDatum(id, value),
        () => {
            editor.solver.removeConstraint(id);
            editor.dimensionAnchors.delete(id);
            editor.solve(true);
        },
    );
}

function currentDistance(solver: SketchSolver, p1: SketchPointRef, p2: SketchPointRef): number {
    const [x1, y1] = solver.pointOf(p1);
    const [x2, y2] = solver.pointOf(p2);
    return Math.hypot(x2 - x1, y2 - y1);
}

/**
 * Endpoints shared with neighbours through coincident constraints make the
 * picked refs point at different entities for what is one line. Rewrite such
 * refs to that line's own endpoints so the dimension — and its hover
 * highlight — belongs to the line the user sees.
 */
function normalizeLineRefs(
    solver: SketchSolver,
    p1: SketchPointRef,
    p2: SketchPointRef,
): [SketchPointRef, SketchPointRef] {
    if (p1.entityId === p2.entityId) return [p1, p2];
    const coincident = (a: SketchPointRef, b: SketchPointRef) =>
        solver.coincidentGroup(a).some((r) => pointRefKey(r) === pointRefKey(b));
    for (const entity of solver.entities()) {
        if (entity.type !== "line") continue;
        const start: SketchPointRef = { entityId: entity.id, pointIndex: 0 };
        const end: SketchPointRef = { entityId: entity.id, pointIndex: 1 };
        if (coincident(start, p1) && coincident(end, p2)) return [start, end];
        if (coincident(start, p2) && coincident(end, p1)) return [end, start];
    }
    return [p1, p2];
}
