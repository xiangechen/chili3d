// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command } from "@chili3d/core";
import {
    type DimensionAnchor,
    lineIntersection,
    pointLineFoot,
    pointLineSignedDistance,
    segmentOffset,
    toDisplayDatum,
    toStorageDatum,
} from "../editor/dimensionLayout";
import type { SketchEditor } from "../editor/sketchEditor";
import {
    ConstraintKind,
    entityRadius,
    pointRefKey,
    type SketchConstraintData,
    type SketchPointRef,
} from "../sketchModel";
import type { SketchSolver } from "../solver";
import { SketchConstraintCommand } from "./sketchConstraints";

@command({ key: "dimension.distance", icon: "icon-dDimension" })
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

@command({ key: "dimension.radius", icon: "icon-dRadius" })
export class RadiusDimensionCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const entityId = await editor.pickEntity("prompt.pickSketchEntity", ["circle", "arc"]);
        if (entityId === undefined) return;

        const entity = editor.solver.entity(entityId)!;
        const center: [number, number] = [entity.params[0], entity.params[1]];
        const radius = entityRadius(entity);
        const position = await pickWithPreview(editor, () =>
            editor.pickPosition("prompt.pickDimensionPosition", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined ? undefined : { kind: "radius", center, radius, position: uv },
                ),
            ),
        );
        if (position === undefined) return;

        // anchor the label as a vector from the center so it follows the geometry
        commitDimension(
            editor,
            {
                kind: ConstraintKind.Radius,
                refs: [{ entityId, pointIndex: 0 }],
                datum: radius,
            },
            { kind: "vector", dx: position[0] - center[0], dy: position[1] - center[1] },
            radius,
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
    options?: { apply?: (id: number, value: number) => void; positiveOnly?: boolean },
): void {
    const id = editor.solver.addConstraint(constraint);
    editor.dimensionAnchors.set(id, anchor);
    editor.solve(true);
    editor.promptDatum(
        initial,
        (value) => (options?.apply ?? ((cid, v) => editor.solver.setDatum(cid, v)))(id, value),
        () => {
            editor.solver.removeConstraint(id);
            editor.dimensionAnchors.delete(id);
            editor.solve(true);
        },
        { positiveOnly: options?.positiveOnly },
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

@command({ key: "dimension.pointLineDistance", icon: "icon-cPointLineDistance" })
export class PointLineDistanceCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const p = await editor.pickPoint("prompt.pickSketchPoint");
        if (p === undefined) return;
        const lineId = await editor.pickEntity("prompt.pickSketchEntity", "line", { datum: true });
        if (lineId === undefined) return;

        const l1: SketchPointRef = { entityId: lineId, pointIndex: 0 };
        const l2: SketchPointRef = { entityId: lineId, pointIndex: 1 };
        const uvP = editor.solver.pointOf(p);
        const uv1 = editor.solver.pointOf(l1);
        const uv2 = editor.solver.pointOf(l2);
        const position = await pickWithPreview(editor, () =>
            editor.pickPosition("prompt.pickDimensionPosition", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined
                        ? undefined
                        : { kind: "pointLine", p: uvP, l1: uv1, l2: uv2, position: uv },
                ),
            ),
        );
        if (position === undefined) return;

        // anchor the label perpendicular to the point→foot segment so it follows the geometry
        const foot = pointLineFoot(uvP, uv1, uv2) ?? uv1;
        // signed datum (display convention: positive = left of the line direction);
        // a signed value keeps the point on its current side instead of mirroring it
        const initial = pointLineSignedDistance(uvP, uv1, uv2);
        commitDimension(
            editor,
            {
                kind: ConstraintKind.P2LDistance,
                refs: [p, l1, l2],
                datum: toStorageDatum(ConstraintKind.P2LDistance, initial),
            },
            { kind: "offset", offset: segmentOffset(uvP, foot, position) },
            initial,
            {
                apply: (id, value) =>
                    editor.solver.setDatum(id, toStorageDatum(ConstraintKind.P2LDistance, value)),
                positiveOnly: false,
            },
        );
    }
}

@command({ key: "dimension.angle", icon: "icon-dAngle" })
export class AngleDimensionCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        // datum: true — angles against the X/Y axes are a common reference
        const l1Id = await editor.pickEntity("prompt.pickSketchEntity", "line", { datum: true });
        if (l1Id === undefined) return;
        const l2Id = await editor.pickEntity("prompt.pickSketchEntity", "line", { datum: true });
        if (l2Id === undefined) return;

        const refs: SketchPointRef[] = [
            { entityId: l1Id, pointIndex: 0 },
            { entityId: l1Id, pointIndex: 1 },
            { entityId: l2Id, pointIndex: 0 },
            { entityId: l2Id, pointIndex: 1 },
        ];
        const [a1, a2, b1, b2] = refs.map((r) => editor.solver.pointOf(r));
        const position = await pickWithPreview(editor, () =>
            editor.pickPosition("prompt.pickDimensionPosition", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined ? undefined : { kind: "angle", a1, a2, b1, b2, position: uv },
                ),
            ),
        );
        if (position === undefined) return;

        // vertex = line intersection; parallel lines fall back to the centroid so the
        // label anchor still has a sensible reference point
        const vertex = lineIntersection(a1, a2, b1, b2) ?? [
            (a1[0] + a2[0] + b1[0] + b2[0]) / 4,
            (a1[1] + a2[1] + b1[1] + b2[1]) / 4,
        ];
        const d1: [number, number] = [a2[0] - a1[0], a2[1] - a1[1]];
        const d2: [number, number] = [b2[0] - b1[0], b2[1] - b1[1]];
        // signed sweep from d1 to d2: the sign records which side of the first
        // line the second line sits on, so later magnitude edits keep the angle
        // in place instead of flipping the line across its reference
        const initialRad = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]);

        const applyAngle = (id: number, value: number) =>
            editor.solver.setDatum(id, toStorageDatum(ConstraintKind.Angle, value));
        commitDimension(
            editor,
            { kind: ConstraintKind.Angle, refs, datum: initialRad },
            { kind: "vector", dx: position[0] - vertex[0], dy: position[1] - vertex[1] },
            toDisplayDatum(ConstraintKind.Angle, initialRad),
            { apply: applyAngle },
        );
    }
}

abstract class AxisDistanceCommand extends SketchConstraintCommand {
    protected abstract readonly axis: "h" | "v";

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const p1 = await editor.pickPoint("prompt.pickSketchPoint");
        if (p1 === undefined) return;
        const p2 = await editor.pickPoint("prompt.pickSketchPoint");
        if (p2 === undefined) return;

        const uv1 = editor.solver.pointOf(p1);
        const uv2 = editor.solver.pointOf(p2);
        const axis = this.axis;
        const position = await pickWithPreview(editor, () =>
            editor.pickPosition("prompt.pickDimensionPosition", (uv) =>
                editor.annotations.setDimensionPreview(
                    uv === undefined
                        ? undefined
                        : { kind: "axisDistance", p1: uv1, p2: uv2, axis, position: uv },
                ),
            ),
        );
        if (position === undefined) return;

        // offset along the cross axis from the points' midline
        const base = axis === "h" ? (uv1[1] + uv2[1]) / 2 : (uv1[0] + uv2[0]) / 2;
        const offset = (axis === "h" ? position[1] : position[0]) - base;
        const initial = axis === "h" ? uv2[0] - uv1[0] : uv2[1] - uv1[1];
        commitDimension(
            editor,
            {
                kind: axis === "h" ? ConstraintKind.HorizontalDistance : ConstraintKind.VerticalDistance,
                refs: [p1, p2],
                datum: initial,
            },
            { kind: "offset", offset },
            initial,
            { positiveOnly: false },
        );
    }
}

@command({ key: "dimension.horizontalDistance", icon: "icon-dDimensionH" })
export class HorizontalDistanceCommand extends AxisDistanceCommand {
    protected readonly axis = "h";
}

@command({ key: "dimension.verticalDistance", icon: "icon-dDimensionV" })
export class VerticalDistanceCommand extends AxisDistanceCommand {
    protected readonly axis = "v";
}
