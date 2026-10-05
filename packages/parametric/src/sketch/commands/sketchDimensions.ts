// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, command, type ParameterValue, PubSub } from "@chili3d/core";
import { type DimensionElement, inferDimension } from "../dimensionInference";
import {
    angleVertex,
    type DimensionAnchor,
    labelOnAxis,
    labelOnSegment,
    measuresSupplement,
    pointLineFoot,
    pointLineSignedDistance,
    signedSweep,
    toDisplayDatum,
    toStorageDatum,
} from "../editor/dimensionLayout";
import type { DimensionPreview } from "../editor/sketchAnnotations";
import type { SketchEditor, SketchElementPick } from "../editor/sketchEditor";
import {
    ConstraintKind,
    datumUnitSpec,
    entityRadius,
    pointRefKey,
    type SketchConstraintData,
    type SketchPointRef,
} from "../sketchModel";
import type { SketchSolver } from "../solver";
import { allowsConstraintOnEntity, normalizeLineRefs } from "../solverEntities";
import { hasDuplicate, SketchConstraintCommand } from "./sketchConstraints";

/** The longest selection the inference table ever reads — two elements, whatever they are. */
const MAX_ELEMENTS = 2;

/**
 * Onshape's Dimension: one tool that reads what you picked instead of being told what to
 * measure. A line is its length, a circle its diameter, two lines an angle, two points
 * whichever distance the label is dragged into (see `inferDimension` for the whole table).
 *
 * A click does two jobs, and which one it does is decided by what it hit — on an element
 * it adds to the selection, on empty space it places what the selection has earned. That
 * is the only arrangement in which "one line is a length" and "two lines are an angle"
 * coexist: a line alone is already a complete dimension, so no rule based on the selection
 * growing could tell "place now" from "I am picking a second line". Hitting nothing is how
 * the user says the second thing.
 *
 * The tool stays up after placing, so a second dimension is the next click rather than a
 * second command — the same shape as `sketch.trim`.
 */
@command({ key: "dimension", icon: "icon-dimension" })
export class DimensionCommand extends SketchConstraintCommand {
    private elements: DimensionElement[] = [];

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.elements = [];
        this.seedFromSelection(editor);
        while (true) {
            const { pick, cancelled } = await this.askOnce(editor);

            if (pick === undefined) {
                // A cancelled command must fall out of the loop: `cancel()` spins until it does.
                if (cancelled) return;
                // Escape in hand throws away the picks; Escape empty-handed ends the tool.
                if (this.elements.length === 0) return;
                this.elements = [];
                continue;
            }

            if (pick.hit.kind === "position") {
                // empty space with nothing picked yet is not a placement, just a stray click
                if (this.elements.length === 0) continue;
                await this.place(editor, pick.uv);
                this.elements = [];
                continue;
            }
            this.accumulate(pick.hit);
        }
    }

    /**
     * Runs one pick and clears its live preview. The controller's status is what tells a
     * cancelled *command* apart from Escape, which cancels the pick alone — and it has to be
     * read before the controller is disposed.
     */
    private async askOnce(
        editor: SketchEditor,
    ): Promise<{ pick: SketchElementPick | undefined; cancelled: boolean }> {
        const controller = new AsyncController();
        this.controller = controller;
        const pick = await editor.pickElement(
            "prompt.pickDimension",
            { datum: true, preview: (uv) => this.showPreview(editor, uv) },
            controller,
        );
        editor.annotations.setDimensionPreview(undefined);
        const cancelled = controller.result?.status === "cancel";
        controller.dispose();
        return { pick, cancelled };
    }

    /**
     * Entities selected before the command ran are the same statement as clicking them, so
     * they seed the selection and the user only has to place. Only entities can arrive this
     * way — a sketch's selection holds no points — so a circle-to-circle distance works
     * from a preselection and a point-to-point one does not.
     *
     * A selection the tool has no reading for is handed back untouched, and said so: the
     * command cannot use it, and clearing it would spend the user's work on nothing.
     */
    private seedFromSelection(editor: SketchEditor): void {
        const ids = editor.selectedEntityIds();
        if (ids.length === 0) return;
        if (ids.length > MAX_ELEMENTS) {
            PubSub.default.pub("statusBarTip", "sketch.dimensionSelectionTooMany");
            return;
        }

        const elements: DimensionElement[] = ids.map((entityId) => ({ kind: "entity", entityId }));
        if (inferDimension(elements, editor.solver) === undefined) {
            PubSub.default.pub("statusBarTip", "sketch.dimensionSelectionUnsupported");
            return;
        }
        // The tool can use it, so it takes it: leaving these highlighted would read as a
        // second, separate selection once the picks start.
        editor.clearEntitySelection();
        this.elements = elements;
    }

    /** Adds one element unless it is already in hand or the selection is as long as it gets. */
    private accumulate(element: DimensionElement): void {
        if (this.elements.length >= MAX_ELEMENTS) return;
        if (this.elements.some((held) => sameElement(held, element))) return;
        this.elements = [...this.elements, element];
    }

    /**
     * The dimension the picks currently mean, previewed at the cursor. Shown from the very
     * first pick, so a line reads as a length before the user commits to anything — and
     * once there are two points, the reading changes as the cursor is dragged around them.
     */
    private showPreview(editor: SketchEditor, uv: [number, number] | undefined): void {
        if (uv === undefined) {
            editor.annotations.setDimensionPreview(undefined);
            return;
        }
        const plan = inferDimension(this.elements, editor.solver);
        editor.annotations.setDimensionPreview(plan?.preview(uv));
    }

    private async place(editor: SketchEditor, label: [number, number]): Promise<void> {
        const resolved = inferDimension(this.elements, editor.solver)?.resolve(label);
        if (resolved === undefined) return;
        const { constraint } = resolved;
        // A dimension is not an associative constraint, so an entity projected from another
        // node cannot take one — `allowsConstraintOnEntity` says so through the status bar.
        if (!constraint.refs.every((ref) => allowsConstraintOnEntity(constraint.kind, ref.entityId))) {
            return;
        }
        // Measuring the same thing twice adds nothing but a redundancy for garlic to report.
        if (hasDuplicate(editor.solver, constraint.kind, constraint.refs)) {
            PubSub.default.pub("statusBarTip", "sketch.constraintExists");
            return;
        }
        await commitDimension(editor, constraint, resolved.anchor, resolved.initial, {
            positiveOnly: resolved.positiveOnly,
        });
    }
}

/** Whether two picks name the same thing — the same point, or the same entity. */
function sameElement(held: DimensionElement, next: DimensionElement): boolean {
    if (held.kind === "entity" || next.kind === "entity") {
        return held.kind === "entity" && next.kind === "entity" && held.entityId === next.entityId;
    }
    return pointRefKey(held.ref) === pointRefKey(next.ref);
}

@command({ key: "dimension.distance", icon: "icon-dDimension" })
export class DistanceDimensionCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const p1 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p1 === undefined || !allowsConstraintOnEntity(ConstraintKind.P2PDistance, p1.entityId)) return;

        // rubber-band line from the first point to the cursor while picking the second
        const uv1 = editor.solver.pointOf(p1);
        this.beginStep();
        const p2 = await pickWithPreview(editor, () =>
            editor.pickPoint(
                "prompt.pickSketchPoint",
                (uv) =>
                    editor.annotations.setDimensionPreview(
                        uv === undefined ? undefined : { kind: "segment", p1: uv1, p2: uv },
                    ),
                this.controller,
            ),
        );
        if (p2 === undefined || !allowsConstraintOnEntity(ConstraintKind.P2PDistance, p2.entityId)) return;

        const uv2 = editor.solver.pointOf(p2);
        const position = await pickDimensionPosition(editor, this.beginStep(), (uv) =>
            uv === undefined ? undefined : { kind: "distance", p1: uv1, p2: uv2, position: uv },
        );
        if (position === undefined) return;

        const initial = currentDistance(editor.solver, p1, p2);
        commitDimension(
            editor,
            {
                kind: ConstraintKind.P2PDistance,
                refs: normalizeLineRefs(editor.solver, p1, p2),
                datum: initial,
            },
            { kind: "offset", ...labelOnSegment(uv1, uv2, position) },
            initial,
        );
    }
}

@command({ key: "dimension.radius", icon: "icon-dRadius" })
export class RadiusDimensionCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const entityId = await editor.pickEntity(
            "prompt.pickSketchEntity",
            ["circle", "arc"],
            undefined,
            this.controller,
        );
        if (entityId === undefined || !allowsConstraintOnEntity(ConstraintKind.Radius, entityId)) return;

        const entity = editor.solver.entity(entityId)!;
        const center: [number, number] = [entity.params[0], entity.params[1]];
        const radius = entityRadius(entity);
        const position = await pickDimensionPosition(editor, this.beginStep(), (uv) =>
            uv === undefined ? undefined : { kind: "radius", center, radius, position: uv },
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
export async function pickWithPreview<T>(
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
 * Picks the dimension-label position with the dimension previewed live. The controller
 * takes the command's slot so `cancel()` aborts exactly this pick, and the preview is
 * cleared once it ends — the placement step the distance-dimension commands share.
 */
export async function pickDimensionPosition(
    editor: SketchEditor,
    controller: AsyncController,
    preview: (uv: [number, number] | undefined) => DimensionPreview | undefined,
): Promise<[number, number] | undefined> {
    return pickWithPreview(editor, () =>
        editor.pickPosition(
            "prompt.pickDimensionPosition",
            (uv) => editor.annotations.setDimensionPreview(preview(uv)),
            controller,
        ),
    );
}

/**
 * Creates the constraint right away so the dimension stays visible while the
 * input is open, but commits only on confirm — creation + datum land in a
 * single undo step; cancelling rolls the constraint back from the solver.
 *
 * Resolves once the input dialog is gone. A tool that places dimensions one after
 * another awaits it: the dialog is modal, so asking for the next pick while it is still
 * open would leave that pick waiting behind a dialog the viewport cannot reach through.
 *
 * What was typed is stored as typed: `setDatumSource` is the whole conversion, because
 * the constraint carries the reading it is written in (`SketchConstraintData.display`).
 */
export function commitDimension(
    editor: SketchEditor,
    constraint: Omit<SketchConstraintData, "id">,
    anchor: DimensionAnchor,
    initial: ParameterValue,
    options?: { positiveOnly?: boolean },
): Promise<void> {
    const id = editor.solver.addConstraint(constraint);
    editor.dimensionAnchors.set(id, anchor);
    editor.solve(true);
    return editor.promptDatum(
        initial,
        (value) => editor.solver.setDatumSource(id, value),
        datumUnitSpec(constraint.kind),
        () => {
            editor.solver.removeConstraint(id);
            editor.dimensionAnchors.delete(id);
            editor.solve(true);
        },
        { positiveOnly: options?.positiveOnly },
    );
}

export function currentDistance(solver: SketchSolver, p1: SketchPointRef, p2: SketchPointRef): number {
    const [x1, y1] = solver.pointOf(p1);
    const [x2, y2] = solver.pointOf(p2);
    return Math.hypot(x2 - x1, y2 - y1);
}

@command({ key: "dimension.pointLineDistance", icon: "icon-cPointLineDistance" })
export class PointLineDistanceCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const p = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p === undefined || !allowsConstraintOnEntity(ConstraintKind.P2LDistance, p.entityId)) return;
        this.beginStep();
        const lineId = await editor.pickEntity(
            "prompt.pickSketchEntity",
            "line",
            { datum: true },
            this.controller,
        );
        if (lineId === undefined || !allowsConstraintOnEntity(ConstraintKind.P2LDistance, lineId)) return;

        const l1: SketchPointRef = { entityId: lineId, pointIndex: 0 };
        const l2: SketchPointRef = { entityId: lineId, pointIndex: 1 };
        const uvP = editor.solver.pointOf(p);
        const uv1 = editor.solver.pointOf(l1);
        const uv2 = editor.solver.pointOf(l2);
        const position = await pickDimensionPosition(editor, this.beginStep(), (uv) =>
            uv === undefined ? undefined : { kind: "pointLine", p: uvP, l1: uv1, l2: uv2, position: uv },
        );
        if (position === undefined) return;

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
            { kind: "offset", ...labelOnSegment(uvP, foot, position) },
            initial,
            { positiveOnly: false },
        );
    }
}

@command({ key: "dimension.angle", icon: "icon-dAngle" })
export class AngleDimensionCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const l1Id = await this.pickLine(editor);
        if (l1Id === undefined) return;
        const l2Id = await this.pickLine(editor);
        if (l2Id === undefined) return;

        const refs: SketchPointRef[] = [
            { entityId: l1Id, pointIndex: 0 },
            { entityId: l1Id, pointIndex: 1 },
            { entityId: l2Id, pointIndex: 0 },
            { entityId: l2Id, pointIndex: 1 },
        ];
        const [a1, a2, b1, b2] = refs.map((r) => editor.solver.pointOf(r));
        const position = await pickDimensionPosition(editor, this.beginStep(), (uv) =>
            uv === undefined ? undefined : { kind: "angle", a1, a2, b1, b2, position: uv },
        );
        if (position === undefined) return;

        const measured = measureAngle(editor.solver, refs, position);
        commitDimension(
            editor,
            { kind: ConstraintKind.Angle, refs: measured.refs, datum: measured.datum },
            {
                kind: "vector",
                dx: position[0] - measured.vertex[0],
                dy: position[1] - measured.vertex[1],
            },
            toDisplayDatum(ConstraintKind.Angle, measured.datum),
        );
    }

    /** One line of the angle; `datum: true` also lets the X/Y axes serve as a reference. */
    private async pickLine(editor: SketchEditor): Promise<number | undefined> {
        this.beginStep();
        const id = await editor.pickEntity(
            "prompt.pickSketchEntity",
            "line",
            { datum: true },
            this.controller,
        );
        return id !== undefined && allowsConstraintOnEntity(ConstraintKind.Angle, id) ? id : undefined;
    }
}

/**
 * The angle a placement asks for: the refs to store it with, its signed datum, and the
 * vertex the label is anchored to. Reversing the second line's refs is what stores the
 * label's choice between the angle and its supplement (see `measuresSupplement`) — the
 * solver, the arc and the text all read that back off the geometry. The sweep's sign
 * records which side of the first line the second sits on, so a later magnitude edit
 * keeps the angle in place instead of flipping the line across its reference.
 */
export function measureAngle(
    solver: SketchSolver,
    refs: readonly SketchPointRef[],
    label: [number, number],
): { refs: SketchPointRef[]; vertex: [number, number]; datum: number } {
    const [a1, a2, b1, b2] = refs.map((r) => solver.pointOf(r));
    const vertex = angleVertex(a1, a2, b1, b2);
    const d1: [number, number] = [a2[0] - a1[0], a2[1] - a1[1]];
    const d2: [number, number] = [b2[0] - b1[0], b2[1] - b1[1]];
    const supplement = measuresSupplement(d1, d2, [label[0] - vertex[0], label[1] - vertex[1]]);
    return {
        refs: supplement ? [refs[0], refs[1], refs[3], refs[2]] : [...refs],
        vertex,
        datum: signedSweep(d1, supplement ? [-d2[0], -d2[1]] : d2),
    };
}

abstract class AxisDistanceCommand extends SketchConstraintCommand {
    protected abstract readonly axis: "h" | "v";

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const kind = this.axis === "h" ? ConstraintKind.HorizontalDistance : ConstraintKind.VerticalDistance;
        this.beginStep();
        const p1 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p1 === undefined || !allowsConstraintOnEntity(kind, p1.entityId)) return;
        this.beginStep();
        const p2 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p2 === undefined || !allowsConstraintOnEntity(kind, p2.entityId)) return;

        const uv1 = editor.solver.pointOf(p1);
        const uv2 = editor.solver.pointOf(p2);
        const axis = this.axis;
        const position = await pickDimensionPosition(editor, this.beginStep(), (uv) =>
            uv === undefined ? undefined : { kind: "axisDistance", p1: uv1, p2: uv2, axis, position: uv },
        );
        if (position === undefined) return;

        const initial = axis === "h" ? uv2[0] - uv1[0] : uv2[1] - uv1[1];
        commitDimension(
            editor,
            {
                kind,
                refs: [p1, p2],
                datum: initial,
            },
            { kind: "offset", ...labelOnAxis(uv1, uv2, axis, position) },
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
