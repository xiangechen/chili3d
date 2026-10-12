// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, CancelableCommand, command, type I18nKeys, PubSub } from "@chili3d/core";
import { SketchEditor, type SketchEntityPick } from "../editor/sketchEditor";
import { ConstraintKind, datumIsReading, pointRefKey, type SketchPointRef } from "../sketchModel";
import type { SketchSolver } from "../solver";
import {
    allowsConstraintOnEntity,
    allowsConstraintOnRefs,
    allowsPointOnOwnEntity,
    coincidenceRefusal,
    equalConstraintFor,
    incidenceIdsOn,
    lineRefs,
    pointOnConstraintFor,
    standsAtEntityPoint,
    subsumedIncidenceIds,
    tangentConstraintFor,
} from "../solverEntities";

function editorOrError(): SketchEditor | undefined {
    const editor = SketchEditor.getActive();
    if (editor === undefined) {
        PubSub.default.pub("displayError", "No active sketch editor");
    }
    return editor;
}

/**
 * The two point refs a picked segment is: a line's own endpoints, or the two control points
 * of a free curve's control net the click landed between (`SketchEntityPick.segment`). What
 * the segment-reading constraints are built from, so a handle line can be constrained the
 * way a line can.
 */
function segmentRefs(pick: SketchEntityPick): [SketchPointRef, SketchPointRef] {
    const [first, second] = pick.segment ?? [0, 1];
    return [
        { entityId: pick.entityId, pointIndex: first },
        { entityId: pick.entityId, pointIndex: second },
    ];
}

export abstract class SketchConstraintCommand extends CancelableCommand {
    async executeAsync(): Promise<void> {
        const editor = editorOrError();
        if (editor === undefined) return;
        await this.executeWithEditor(editor);
    }

    protected abstract executeWithEditor(editor: SketchEditor): Promise<void>;

    /**
     * Moves onto a fresh controller for the next step. Every pick needs one of its own: a
     * pick is left riding whichever controller started it, so a step reusing the previous
     * one leaves `cancel()` reaching only that earlier step — and only while it is still
     * unresolved.
     *
     * Answers with the controller for steps that need it in hand; the rest read back
     * `this.controller`, which this sets.
     */
    protected beginStep(): AsyncController {
        const controller = new AsyncController();
        this.controller = controller;
        return controller;
    }
}

/**
 * Same-kind constraint with the same ref set already exists — adding it would be redundant.
 *
 * This reads the *picks*: a row that says the same thing through a coincident neighbour of
 * them is not one it can see, and must not be guessed at — reading the refs by the place each
 * point stands fuses structurally different statements with it (a closed quad's two pairs of
 * opposite sides are the same set of places). The callers that can name such rows pass
 * `alreadyStated` instead; see `addAndCommit`.
 *
 * Only the geometric constraints go through this (`addAndCommit`): a *dimension* is never
 * refused ahead of the solve, because the solver's own verdict is what decides whether it
 * drives or becomes a reference (see `commitDimension`).
 *
 * `SketchSolver.hasConstraint` is the same question of the live records — reading it off
 * `toData()` asked it of a full copy of the sketch, entities and externals included, which is
 * a lossy way to spell "is this row already there".
 */
export function hasDuplicate(solver: SketchSolver, kind: ConstraintKind, refs: SketchPointRef[]): boolean {
    return solver.hasConstraint(kind, refs);
}

/**
 * Adds the constraint unless it is already there, then solves and commits.
 *
 * `alreadyStated` is the caller's own answer to "is this already said", for the rows it can
 * name and `hasDuplicate` cannot: a coincidence puts the picked point where a row on its
 * neighbour is, and which end of that pair a row was written on is not a difference between
 * the two statements. `existingTip` is what to say instead of "constraint already exists".
 *
 * `subsumes` names the constraints the new one restates. They go whether or not the new one
 * had to be added — a pair an older document carries is what the tool is here to settle — and
 * they go in the same edit, so one undo brings them back. `subsumedTip` says so: the tool
 * changed the constraint list without being asked to.
 */
function addAndCommit(
    editor: SketchEditor,
    kind: ConstraintKind,
    refs: SketchPointRef[],
    options?: {
        datum?: number;
        datums?: number[];
        alreadyStated?: boolean;
        existingTip?: I18nKeys;
        subsumes?: readonly number[];
        subsumedTip?: I18nKeys;
    },
): void {
    const { alreadyStated, existingTip, subsumes = [], subsumedTip, ...extra } = options ?? {};
    const existing = alreadyStated === true || hasDuplicate(editor.solver, kind, refs);
    // there is nothing to add and nothing to settle: the constraint is there and the sketch
    // already reads the way the tool would leave it
    if (existing && subsumes.length === 0) {
        PubSub.default.pub("showToast", existingTip ?? "sketch.constraintExists");
        return;
    }
    if (!existing) editor.solver.addConstraint({ kind, refs, ...extra });
    for (const id of subsumes) editor.solver.removeConstraint(id);
    // the session state goes with them — a deselected badge, the anchor (see `forgetConstraints`)
    editor.forgetConstraints(subsumes);
    if (subsumes.length > 0 && subsumedTip !== undefined) PubSub.default.pub("showToast", subsumedTip);
    editor.solve(true);
    editor.commit();
}

/**
 * Two picked points fused into one place.
 *
 * The coincidence is the stronger statement when either point already carries an incidence onto
 * an entity the other is a point of: with the two standing in one place "this point is on that
 * line" follows from the line's own structure, so that row is what the tool settles
 * (`subsumedIncidenceIds` — both ends, since either pick order says the same thing). Left in,
 * the pair is a row that says nothing: garlic reads it as a redundant group as soon as the rest
 * of the sketch determines the point, and the panel then offers to delete either of them, of
 * which only the incidence is the one the user meant to give up. FreeCAD drops the same row
 * from the other end (`removeRedundantPointOnObject`, when a B-spline internally implies
 * point-on-object) and says so.
 *
 * That reading has a boundary, and `coincidenceRefusal` draws it: a midpoint holds the point at
 * a place of its own on the entity, and an entity's own curve misses its center and its inner
 * control points, so a fuse onto either is refused rather than settled by deleting something
 * the user asked for.
 */
@command({ key: "constraint.coincident", icon: "icon-cCoincident" })
export class CoincidentConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const p1 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p1 === undefined) return;
        this.beginStep();
        const p2 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p2 === undefined) return;
        // the gate every other constraint command opens with: an array's instance is placed by
        // its pattern, so constraining one would fight the array that owns it
        if (!allowsConstraintOnRefs(editor.solver, ConstraintKind.P2PCoincident, [p1, p2])) return;
        // the picks a fuse cannot hold on, refused rather than left to the solve — which reads
        // them as a guard conflict and then tells the user no single deletion helps. After the
        // gate above, so that a pick the sketch cannot take at all is the one reported.
        const refusal = coincidenceRefusal(editor.solver, p1, p2);
        if (refusal !== undefined) {
            PubSub.default.pub("showToast", refusal);
            return;
        }
        // two points the sketch already holds in one place say nothing new: the row is there
        // through the chain of coincidences, and adding a third over the same place reads back
        // as a redundancy group the user never asked for
        const stated = editor.solver
            .coincidentPeers(p1)
            .some((peer) => pointRefKey(peer) === pointRefKey(p2));
        addAndCommit(editor, ConstraintKind.P2PCoincident, [p1, p2], {
            alreadyStated: stated,
            subsumes: subsumedIncidenceIds(editor.solver, p1, p2),
            subsumedTip: "sketch.coincidentSubsumed",
        });
    }
}

abstract class LineConstraintCommand extends SketchConstraintCommand {
    protected abstract readonly kind: ConstraintKind.Horizontal | ConstraintKind.Vertical;

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        // a segment: a line, or the line between two control points of a free curve — the
        // net the editor draws dashed, so "make this handle line horizontal" is a pick
        const pick = await editor.pickEntityAt(
            "prompt.pickSketchEntity",
            "line",
            { segments: true },
            this.controller,
        );
        if (pick === undefined || !allowsConstraintOnEntity(editor.solver, this.kind, pick.entityId)) return;
        editor.solver.addConstraint({ kind: this.kind, refs: segmentRefs(pick) });
        editor.solve(true);
        editor.commit();
    }
}

@command({ key: "constraint.horizontal", icon: "icon-cHorizontal" })
export class HorizontalConstraintCommand extends LineConstraintCommand {
    protected readonly kind = ConstraintKind.Horizontal;
}

@command({ key: "constraint.vertical", icon: "icon-cVertical" })
export class VerticalConstraintCommand extends LineConstraintCommand {
    protected readonly kind = ConstraintKind.Vertical;
}

abstract class TwoLineConstraintCommand extends SketchConstraintCommand {
    protected abstract readonly kind: ConstraintKind.Parallel | ConstraintKind.Perpendicular;

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const next = () =>
            editor.pickEntityAt(
                "prompt.pickSketchEntity",
                "line",
                { datum: true, segments: true },
                this.beginStep(),
            );
        const first = await next();
        if (first === undefined || !allowsConstraintOnEntity(editor.solver, this.kind, first.entityId))
            return;
        const second = await next();
        if (second === undefined || !allowsConstraintOnEntity(editor.solver, this.kind, second.entityId))
            return;
        addAndCommit(editor, this.kind, [...segmentRefs(first), ...segmentRefs(second)]);
    }
}

@command({ key: "constraint.parallel", icon: "icon-cParallel" })
export class ParallelConstraintCommand extends TwoLineConstraintCommand {
    protected readonly kind = ConstraintKind.Parallel;
}

@command({ key: "constraint.perpendicular", icon: "icon-cPerpendicular" })
export class PerpendicularConstraintCommand extends TwoLineConstraintCommand {
    protected readonly kind = ConstraintKind.Perpendicular;
}

abstract class TwoPointConstraintCommand extends SketchConstraintCommand {
    protected abstract readonly kind: ConstraintKind.HorizontalAlign | ConstraintKind.VerticalAlign;

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const p1 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p1 === undefined) return;
        this.beginStep();
        const p2 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p2 === undefined) return;
        // the pair is what the rule reads: either point may be a projected one, as long as
        // the other is real geometry for the alignment to move
        if (!allowsConstraintOnRefs(editor.solver, this.kind, [p1, p2])) return;
        addAndCommit(editor, this.kind, [p1, p2]);
    }
}

@command({ key: "constraint.horizontalAlign", icon: "icon-cAlignH" })
export class HorizontalAlignConstraintCommand extends TwoPointConstraintCommand {
    protected readonly kind = ConstraintKind.HorizontalAlign;
}

@command({ key: "constraint.verticalAlign", icon: "icon-cAlignV" })
export class VerticalAlignConstraintCommand extends TwoPointConstraintCommand {
    protected readonly kind = ConstraintKind.VerticalAlign;
}

/** Picks two entities of the same type and applies the matching equal constraint. */
@command({ key: "constraint.equal", icon: "icon-cEqual" })
export class EqualConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const e1 = await editor.pickEntity("prompt.pickSketchEntity", undefined, undefined, this.controller);
        if (e1 === undefined) return;
        this.beginStep();
        const e2 = await editor.pickEntity("prompt.pickSketchEntity", undefined, undefined, this.controller);
        if (e2 === undefined) return;
        if (e1 === e2) {
            PubSub.default.pub("displayError", "Pick two different entities");
            return;
        }
        const t1 = editor.solver.entity(e1)?.type;
        const t2 = editor.solver.entity(e2)?.type;
        if (t1 === undefined || t1 !== t2) {
            PubSub.default.pub("displayError", "Equal requires two entities of the same type");
            return;
        }
        const equal = equalConstraintFor(t1, e1, e2);
        if (equal === undefined) {
            PubSub.default.pub("displayError", "Equal applies to lines, circles and arcs");
            return;
        }
        if (!allowsConstraintOnRefs(editor.solver, equal.kind, equal.refs)) return;
        addAndCommit(editor, equal.kind, equal.refs);
    }
}

/** Picks two entities (any order) and applies the matching tangent constraint. */
@command({ key: "constraint.tangent", icon: "icon-cTangent" })
export class TangentConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const e1 = await editor.pickEntity("prompt.pickSketchEntity", undefined, undefined, this.controller);
        if (e1 === undefined) return;
        this.beginStep();
        const e2 = await editor.pickEntity("prompt.pickSketchEntity", undefined, undefined, this.controller);
        if (e2 === undefined) return;
        if (e1 === e2) {
            PubSub.default.pub("displayError", "Pick two different entities");
            return;
        }
        const t1 = editor.solver.entity(e1)?.type;
        const t2 = editor.solver.entity(e2)?.type;
        const tangent = tangentConstraintFor(t1, e1, t2, e2);
        if (tangent === undefined) {
            PubSub.default.pub("displayError", "Tangent does not apply to two lines");
            return;
        }
        if (!allowsConstraintOnRefs(editor.solver, tangent.kind, tangent.refs)) return;
        addAndCommit(editor, tangent.kind, tangent.refs);
    }
}

/** Picks a point and an entity (or a datum axis), constraining the point onto it. */
@command({ key: "constraint.pointOn", icon: "icon-cPointOn" })
export class PointOnConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const p = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p === undefined) return;
        this.beginStep();
        const entityId = await editor.pickEntity(
            "prompt.pickSketchEntity",
            undefined,
            { datum: true },
            this.controller,
        );
        if (entityId === undefined) return;
        const constraint = pointOnConstraintFor(editor.solver.entity(entityId)?.type, p, entityId);
        if (constraint === undefined) return;
        // the same gate every other constraint command opens with: an array's instance may not
        // be constrained at all, the pick layer being the one that cannot tell
        if (!allowsConstraintOnRefs(editor.solver, constraint.kind, constraint.refs)) return;
        // a point of the entity itself says nothing — the constraint is either one the entity
        // already carries or one that collapses it
        if (!allowsPointOnOwnEntity(editor.solver, p, entityId)) return;
        // What the tool was asked for may already be said — by a row of the same kind on a
        // coincident neighbour of the picked point, or by the midpoint of that same line, which
        // holds the point on it for good. Both are read off the rows here, where `hasDuplicate`
        // reads the picks and can name neither.
        const heldByMidpoint = incidenceIdsOn(editor.solver, p, entityId, [ConstraintKind.Midpoint]);
        const restated = incidenceIdsOn(editor.solver, p, entityId, [constraint.kind]);
        addAndCommit(editor, constraint.kind, constraint.refs, {
            alreadyStated: heldByMidpoint.length > 0 || restated.length > 0,
            existingTip: heldByMidpoint.length > 0 ? "sketch.midpointHoldsPoint" : "sketch.constraintExists",
            // a row the midpoint restates is the one this run settles; without a midpoint it is
            // a statement of its own and goes nowhere
            subsumes: heldByMidpoint.length > 0 ? restated : [],
            subsumedTip: "sketch.pointOnSubsumed",
        });
    }
}

@command({ key: "constraint.midpoint", icon: "icon-cMid" })
export class MidpointConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const p = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p === undefined) return;
        this.beginStep();
        const lineId = await editor.pickEntity("prompt.pickSketchEntity", "line", undefined, this.controller);
        if (lineId === undefined) return;
        // a projected edge is a legitimate midpoint to hold a real point against — the
        // external is what stays put, the point is what moves
        const refs = [p, ...lineRefs(lineId)];
        if (!allowsConstraintOnRefs(editor.solver, ConstraintKind.Midpoint, refs)) return;
        // an end of the picked line has no midpoint of its own to be: the constraint holds
        // only with the line collapsed, which the solve reports as a conflict. After the gate
        // above, so that a pick the sketch cannot take at all is the one reported
        if (standsAtEntityPoint(editor.solver, p, lineId)) {
            PubSub.default.pub("showToast", "sketch.midpointOnOwnEnd");
            return;
        }
        // A midpoint is strictly stronger than an incidence onto the same line — it pins the
        // point at (S+E)/2, which is on the line by construction — so that incidence is a row
        // the midpoint already carries. Left in, the pair reads as a redundant group as soon
        // as the rest of the sketch determines the point, and the panel then offers to delete
        // either of them, of which only the incidence is the one the user meant to give up.
        // FreeCAD drops the same constraint from the other end (`removeRedundantPointOnObject`,
        // when a tangent or perpendicular onto a B-spline internally implies it) and says so.
        //
        // A midpoint that already holds this point on that line — on a coincident neighbour of
        // it as much as on the picked point — is this same statement: one row for the place,
        // not one per point standing in it.
        const heldByMidpoint = incidenceIdsOn(editor.solver, p, lineId, [ConstraintKind.Midpoint]);
        const subsumes = incidenceIdsOn(editor.solver, p, lineId, [ConstraintKind.PointOnLine]);
        addAndCommit(editor, ConstraintKind.Midpoint, refs, {
            alreadyStated: heldByMidpoint.length > 0,
            subsumes,
            subsumedTip: "sketch.pointOnSubsumed",
        });
    }
}

/** Two points symmetric about a picked line or datum axis. */
@command({ key: "constraint.symmetric", icon: "icon-cSymmetric" })
export class SymmetricConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const p1 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p1 === undefined) return;
        this.beginStep();
        const p2 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p2 === undefined) return;
        this.beginStep();
        const lineId = await editor.pickEntity(
            "prompt.pickSketchEntity",
            "line",
            { datum: true },
            this.controller,
        );
        if (lineId === undefined) return;
        // the mirror line may be a projected edge: it is the fixed side the two points
        // reflect across, and both of them are the user's own geometry to move
        const refs = [p1, p2, ...lineRefs(lineId)];
        if (!allowsConstraintOnRefs(editor.solver, ConstraintKind.Symmetric, refs)) return;
        addAndCommit(editor, ConstraintKind.Symmetric, refs);
    }
}

/** Pins a point at its current coordinates (two datum values, double-click the badge to edit). */
@command({ key: "constraint.fix", icon: "icon-cFix" })
export class FixConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.beginStep();
        const p = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p === undefined || !allowsConstraintOnEntity(editor.solver, ConstraintKind.Fix, p.entityId))
            return;
        addAndCommit(editor, ConstraintKind.Fix, [p], { datums: [...editor.solver.pointOf(p)] });
    }
}

/**
 * FreeCAD's "Toggle driving/reference constraint", on the selected dimensions: they become
 * reference measurements, or go back to driving the sketch.
 *
 * A selection is read as one statement, so a mixed one converges on driven — the dimension
 * that already measures is not the one at fault. Nothing checks the reverse direction:
 * turning a reference back on can restate a dimension that already drives that geometry,
 * and the sketch reports that as a redundancy for the user to resolve, which is the same
 * answer every other over-constraining edit in the editor gets.
 */
@command({ key: "constraint.toggleDriven", icon: "icon-lock" })
export class ToggleDrivenConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        const selected = new Set(editor.annotations.selectedConstraintIds);
        const dimensions = editor.solver
            .toData()
            .constraints.filter((c) => selected.has(c.id) && datumIsReading(c.kind) && c.datum !== undefined);
        // A constraint with no reading of its own has nothing to make a reference of: a purely
        // geometric one carries no datum, and a Fix — which does carry datums, its coordinates —
        // is not a reading either (`datumIsReading`).
        if (dimensions.length === 0) {
            PubSub.default.pub("showToast", "sketch.drivenSelectDimension");
            return;
        }
        editor.setConstraintsDriven(
            dimensions.map((c) => c.id),
            dimensions.some((c) => c.driven !== true),
        );
    }
}
