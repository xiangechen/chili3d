// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, CancelableCommand, command, PubSub } from "@chili3d/core";
import { SketchEditor } from "../editor/sketchEditor";
import { ConstraintKind, pointRefKey, type SketchEntityType, type SketchPointRef } from "../sketchModel";
import type { SketchSolver } from "../solver";
import { allowsConstraintOnEntity } from "../solverEntities";

function editorOrError(): SketchEditor | undefined {
    const editor = SketchEditor.getActive();
    if (editor === undefined) {
        PubSub.default.pub("displayError", "No active sketch editor");
    }
    return editor;
}

export abstract class SketchConstraintCommand extends CancelableCommand {
    async executeAsync(): Promise<void> {
        const editor = editorOrError();
        if (editor === undefined) return;
        await this.executeWithEditor(editor);
    }

    protected abstract executeWithEditor(editor: SketchEditor): Promise<void>;
}

const lineRefs = (entityId: number): SketchPointRef[] => [
    { entityId, pointIndex: 0 },
    { entityId, pointIndex: 1 },
];

const centerRef = (entityId: number): SketchPointRef => ({ entityId, pointIndex: 0 });
const arcStartRef = (entityId: number): SketchPointRef => ({ entityId, pointIndex: 1 });

/** Same-kind constraint with the same ref set already exists — adding it would be redundant. */
function hasDuplicate(solver: SketchSolver, kind: ConstraintKind, refs: SketchPointRef[]): boolean {
    const key = refs.map(pointRefKey).sort().join("|");
    return solver
        .toData()
        .constraints.some((c) => c.kind === kind && c.refs.map(pointRefKey).sort().join("|") === key);
}

/** Adds the constraint unless redundant, then solves and commits. */
function addAndCommit(
    editor: SketchEditor,
    kind: ConstraintKind,
    refs: SketchPointRef[],
    extra?: { datum?: number; datums?: number[] },
): void {
    if (hasDuplicate(editor.solver, kind, refs)) {
        PubSub.default.pub("statusBarTip", "sketch.constraintExists");
        return;
    }
    editor.solver.addConstraint({ kind, refs, ...extra });
    editor.solve(true);
    editor.commit();
}

@command({ key: "constraint.coincident", icon: "icon-cCoincident" })
export class CoincidentConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.controller = new AsyncController();
        const p1 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p1 === undefined) return;
        this.controller = new AsyncController();
        const p2 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p2 === undefined) return;
        editor.solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [p1, p2] });
        editor.solve(true);
        editor.commit();
    }
}

abstract class LineConstraintCommand extends SketchConstraintCommand {
    protected abstract readonly kind: ConstraintKind.Horizontal | ConstraintKind.Vertical;

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.controller = new AsyncController();
        const lineId = await editor.pickEntity("prompt.pickSketchEntity", "line", undefined, this.controller);
        if (lineId === undefined || !allowsConstraintOnEntity(this.kind, lineId)) return;
        editor.solver.addConstraint({
            kind: this.kind,
            refs: [
                { entityId: lineId, pointIndex: 0 },
                { entityId: lineId, pointIndex: 1 },
            ],
        });
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
        this.controller = new AsyncController();
        const l1 = await editor.pickEntity(
            "prompt.pickSketchEntity",
            "line",
            { datum: true },
            this.controller,
        );
        if (l1 === undefined) return;
        this.controller = new AsyncController();
        const l2 = await editor.pickEntity(
            "prompt.pickSketchEntity",
            "line",
            { datum: true },
            this.controller,
        );
        if (l2 === undefined) return;
        addAndCommit(editor, this.kind, [...lineRefs(l1), ...lineRefs(l2)]);
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
        this.controller = new AsyncController();
        const p1 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p1 === undefined || !allowsConstraintOnEntity(this.kind, p1.entityId)) return;
        this.controller = new AsyncController();
        const p2 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p2 === undefined || !allowsConstraintOnEntity(this.kind, p2.entityId)) return;
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
        this.controller = new AsyncController();
        const e1 = await editor.pickEntity("prompt.pickSketchEntity", undefined, undefined, this.controller);
        if (e1 === undefined) return;
        this.controller = new AsyncController();
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
        const refs =
            t1 === "line"
                ? [...lineRefs(e1), ...lineRefs(e2)]
                : t1 === "circle"
                  ? [centerRef(e1), centerRef(e2)]
                  : [centerRef(e1), arcStartRef(e1), centerRef(e2), arcStartRef(e2)];
        const kind =
            t1 === "line"
                ? ConstraintKind.EqualLength
                : t1 === "circle"
                  ? ConstraintKind.EqualRadius
                  : ConstraintKind.EqualArcRadius;
        addAndCommit(editor, kind, refs);
    }
}

/** Picks two entities (any order) and applies the matching tangent constraint. */
@command({ key: "constraint.tangent", icon: "icon-cTangent" })
export class TangentConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.controller = new AsyncController();
        const e1 = await editor.pickEntity("prompt.pickSketchEntity", undefined, undefined, this.controller);
        if (e1 === undefined) return;
        this.controller = new AsyncController();
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
        addAndCommit(editor, tangent.kind, tangent.refs);
    }
}

function tangentConstraintFor(
    t1: SketchEntityType | undefined,
    e1: number,
    t2: SketchEntityType | undefined,
    e2: number,
): { kind: ConstraintKind; refs: SketchPointRef[] } | undefined {
    const pair = [t1, t2].sort().join("+");
    // normalize pick order so refs match the garlic params layout
    if (pair === "circle+line") {
        const [line, circle] = t1 === "line" ? [e1, e2] : [e2, e1];
        return { kind: ConstraintKind.TangentLineCircle, refs: [...lineRefs(line), centerRef(circle)] };
    }
    if (pair === "arc+line") {
        const [line, arc] = t1 === "line" ? [e1, e2] : [e2, e1];
        return {
            kind: ConstraintKind.TangentLineArc,
            refs: [...lineRefs(line), centerRef(arc), arcStartRef(arc)],
        };
    }
    return roundTangentConstraint(pair, t1, e1, e2);
}

/** The tangency kinds with no line in the pair — circles and arcs only. */
function roundTangentConstraint(
    pair: string,
    t1: SketchEntityType | undefined,
    e1: number,
    e2: number,
): { kind: ConstraintKind; refs: SketchPointRef[] } | undefined {
    // refs match the garlic params layout, so the circle comes first here too
    if (pair === "circle+circle") {
        return { kind: ConstraintKind.TangentCircleCircle, refs: [centerRef(e1), centerRef(e2)] };
    }
    if (pair === "arc+arc") {
        return {
            kind: ConstraintKind.TangentArcArc,
            refs: [centerRef(e1), arcStartRef(e1), centerRef(e2), arcStartRef(e2)],
        };
    }
    if (pair === "arc+circle") {
        const [circle, arc] = t1 === "circle" ? [e1, e2] : [e2, e1];
        return {
            kind: ConstraintKind.TangentCircleArc,
            refs: [centerRef(circle), centerRef(arc), arcStartRef(arc)],
        };
    }
    return undefined;
}

/** Picks a point and an entity (or a datum axis), constraining the point onto it. */
@command({ key: "constraint.pointOn", icon: "icon-cPointOn" })
export class PointOnConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.controller = new AsyncController();
        const p = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p === undefined) return;
        this.controller = new AsyncController();
        const entityId = await editor.pickEntity(
            "prompt.pickSketchEntity",
            undefined,
            { datum: true },
            this.controller,
        );
        if (entityId === undefined) return;
        const type = editor.solver.entity(entityId)?.type;
        if (type === "line") {
            addAndCommit(editor, ConstraintKind.PointOnLine, [p, ...lineRefs(entityId)]);
        } else if (type === "circle") {
            addAndCommit(editor, ConstraintKind.PointOnCircle, [p, centerRef(entityId)]);
        } else if (type === "arc") {
            addAndCommit(editor, ConstraintKind.PointOnArc, [p, centerRef(entityId), arcStartRef(entityId)]);
        }
    }
}

@command({ key: "constraint.midpoint", icon: "icon-cMid" })
export class MidpointConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.controller = new AsyncController();
        const p = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p === undefined) return;
        this.controller = new AsyncController();
        const lineId = await editor.pickEntity("prompt.pickSketchEntity", "line", undefined, this.controller);
        if (lineId === undefined || !allowsConstraintOnEntity(ConstraintKind.Midpoint, lineId)) return;
        addAndCommit(editor, ConstraintKind.Midpoint, [p, ...lineRefs(lineId)]);
    }
}

/** Two points symmetric about a picked line or datum axis. */
@command({ key: "constraint.symmetric", icon: "icon-cSymmetric" })
export class SymmetricConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.controller = new AsyncController();
        const p1 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p1 === undefined) return;
        this.controller = new AsyncController();
        const p2 = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p2 === undefined) return;
        this.controller = new AsyncController();
        const lineId = await editor.pickEntity(
            "prompt.pickSketchEntity",
            "line",
            { datum: true },
            this.controller,
        );
        if (lineId === undefined || !allowsConstraintOnEntity(ConstraintKind.Symmetric, lineId)) return;
        addAndCommit(editor, ConstraintKind.Symmetric, [p1, p2, ...lineRefs(lineId)]);
    }
}

/** Pins a point at its current coordinates (two datum values, double-click the badge to edit). */
@command({ key: "constraint.fix", icon: "icon-cFix" })
export class FixConstraintCommand extends SketchConstraintCommand {
    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.controller = new AsyncController();
        const p = await editor.pickPoint("prompt.pickSketchPoint", undefined, this.controller);
        if (p === undefined || !allowsConstraintOnEntity(ConstraintKind.Fix, p.entityId)) return;
        addAndCommit(editor, ConstraintKind.Fix, [p], { datums: [...editor.solver.pointOf(p)] });
    }
}
