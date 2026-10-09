// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "@chili3d/core";
import {
    ConstraintKind,
    isExternalEntityId,
    pointRefKey,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver } from "./solver";

/**
 * Every entity a constraint or snap can target: the real sketch entities plus
 * the seeded external references. Externals are pinned (never draggable or
 * deletable), so a constraint snapped onto one is always satisfiable from the
 * sketch side. Construction geometry is included — it is drawn, so it is a
 * legitimate pick and constraint target like any other entity.
 */
export function constraintTargetEntities(solver: SketchSolver): SketchEntityData[] {
    return [...solver.entities(), ...solver.externalEntitiesData()];
}

/**
 * Every entity a snap may land on: the constraint targets less the array instances. An
 * instance is drawn and picked like any other entity, but it is placed by its record — a
 * snap onto one would leave a constraint the next solve overwrites, which is the same
 * reason `allowsConstraintOnEntity` refuses one.
 */
export function snapTargetEntities(solver: SketchSolver): SketchEntityData[] {
    return constraintTargetEntities(solver).filter((entity) => !solver.isDerived(entity.id));
}

/**
 * Kinds that may reference an external entity: they relate real geometry to the
 * external (which never moves), so the real side follows it. Rigid or datum
 * kinds (Horizontal/Vertical, Fix, distances, angles, Radius) would only fight
 * the external's structural pins — redundant at best, an unsatisfiable conflict
 * at worst.
 */
const ASSOCIATIVE_KINDS: readonly ConstraintKind[] = [
    ConstraintKind.P2PCoincident,
    ConstraintKind.PointOnLine,
    ConstraintKind.PointOnCircle,
    ConstraintKind.PointOnArc,
    ConstraintKind.PointOnEllipse,
    ConstraintKind.PointOnConic,
    ConstraintKind.PointOnBezier,
    ConstraintKind.PointOnNurbs,
    ConstraintKind.Parallel,
    ConstraintKind.Perpendicular,
    ConstraintKind.EqualLength,
    ConstraintKind.EqualRadius,
    ConstraintKind.EqualArcRadius,
    ConstraintKind.TangentLineCircle,
    ConstraintKind.TangentCircleCircle,
    ConstraintKind.TangentLineArc,
    ConstraintKind.TangentArcArc,
    ConstraintKind.TangentCircleArc,
    ConstraintKind.TangentLineEllipse,
    ConstraintKind.TangentLineConic,
    ConstraintKind.TangentLineBezier,
    ConstraintKind.TangentLineNurbs,
    ConstraintKind.TangentCircleEllipse,
    ConstraintKind.TangentArcEllipse,
    ConstraintKind.TangentCircleConic,
    ConstraintKind.TangentArcConic,
    ConstraintKind.TangentCircleBezier,
    ConstraintKind.TangentArcBezier,
    ConstraintKind.TangentCircleNurbs,
    ConstraintKind.TangentArcNurbs,
    ConstraintKind.TangentEllipseEllipse,
    ConstraintKind.TangentEllipseConic,
    ConstraintKind.TangentEllipseBezier,
    ConstraintKind.TangentEllipseNurbs,
    ConstraintKind.TangentConicConic,
    ConstraintKind.TangentConicBezier,
    ConstraintKind.TangentConicNurbs,
    ConstraintKind.TangentBezierBezier,
    ConstraintKind.TangentBezierNurbs,
    ConstraintKind.TangentNurbsNurbs,
];

export function isAssociativeConstraintKind(kind: ConstraintKind): boolean {
    return ASSOCIATIVE_KINDS.includes(kind);
}

/**
 * Whether `kind` may target the picked entity. An external entity accepts only associative
 * kinds, and an array's instance accepts nothing at all: the pattern writes its parameters
 * back on every solve, so a constraint on one would be fighting the array it belongs to —
 * the same answer SolidWorks documents for a patterned instance. A rejected pick pubs a
 * status-bar tip and returns false.
 */
export function allowsConstraintOnEntity(
    solver: SketchSolver,
    kind: ConstraintKind,
    entityId: number,
): boolean {
    if (solver.isDerived(entityId)) {
        PubSub.default.pub("statusBarTip", "sketch.arrayInstanceReadOnly");
        return false;
    }
    if (!isExternalEntityId(entityId) || isAssociativeConstraintKind(kind)) return true;
    PubSub.default.pub("statusBarTip", "sketch.externalRefAssociativeOnly");
    return false;
}

/** Point refs addressing an entity as a line (pointIndex 0/1). */
export function lineRefs(entityId: number): SketchPointRef[] {
    return [
        { entityId, pointIndex: 0 },
        { entityId, pointIndex: 1 },
    ];
}

/** Point ref of an entity's center (pointIndex 0 of a circle or an arc). */
export function centerRef(entityId: number): SketchPointRef {
    return { entityId, pointIndex: 0 };
}

/** Point ref of an arc's start (pointIndex 1), the point that fixes its radius. */
export function arcStartRef(entityId: number): SketchPointRef {
    return { entityId, pointIndex: 1 };
}

/**
 * The incidence constraint pinning `point` onto the entity's curve, refs in the
 * garlic params layout. The ellipse and the free curves read the curve's entity id
 * alone, so their second ref is the plain `{entityId, 0}`; `undefined` for a type
 * with no PointOn (none — every entity type has one; the datum axes pass as lines).
 */
export function pointOnConstraintFor(
    type: SketchEntityType | undefined,
    point: SketchPointRef,
    entityId: number,
): { kind: ConstraintKind; refs: SketchPointRef[] } | undefined {
    switch (type) {
        case "line":
            return { kind: ConstraintKind.PointOnLine, refs: [point, ...lineRefs(entityId)] };
        case "circle":
            return { kind: ConstraintKind.PointOnCircle, refs: [point, centerRef(entityId)] };
        case "arc":
            return {
                kind: ConstraintKind.PointOnArc,
                refs: [point, centerRef(entityId), arcStartRef(entityId)],
            };
        case "ellipse":
        case "ellipseArc":
            return { kind: ConstraintKind.PointOnEllipse, refs: [point, { entityId, pointIndex: 0 }] };
        case "conic":
            return { kind: ConstraintKind.PointOnConic, refs: [point, { entityId, pointIndex: 0 }] };
        case "bezier":
            return { kind: ConstraintKind.PointOnBezier, refs: [point, { entityId, pointIndex: 0 }] };
        case "nurbs":
            return { kind: ConstraintKind.PointOnNurbs, refs: [point, { entityId, pointIndex: 0 }] };
        default:
            return undefined;
    }
}

/**
 * The two point refs a distance between them should be stored as. Endpoints shared with
 * neighbours through coincident constraints make the picked refs point at different
 * entities for what is one line; rewriting them to that line's own endpoints is what makes
 * the dimension — and its hover highlight — belong to the line the user sees.
 */
export function normalizeLineRefs(
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

/**
 * Coincides each entity's end point with the start point of the next, closing the
 * chain into a loop. The callers are the commands that lay a shape's edges out one
 * after another — the rectangle's four sides, the regular polygon's N.
 */
export function joinLoop(solver: SketchSolver, entities: readonly number[]): void {
    for (let i = 0; i < entities.length; i++) {
        solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [
                { entityId: entities[i], pointIndex: 1 },
                { entityId: entities[(i + 1) % entities.length], pointIndex: 0 },
            ],
        });
    }
}

/**
 * garlic's curve family for a tangent pair: an ellipseArc reads as its ellipse —
 * the curve-curve layouts carry only the c/m/n core, not the sweep.
 */
type TangentFamily = "circle" | "arc" | "ellipse" | "conic" | "bezier" | "nurbs";

/**
 * garlic normalizes a curve-curve pair along this rank:
 * Circle < Arc < Ellipse < Conic < Bezier < Nurbs. The two free families are ranked apart
 * even though a cubic bezier is a NURBS: it is the *fixed* cubic garlic has a kind of its
 * own for, and the pair's kinds are named by family.
 */
const FAMILY_RANK: Record<TangentFamily, number> = {
    circle: 0,
    arc: 1,
    ellipse: 2,
    conic: 3,
    bezier: 4,
    nurbs: 5,
};

function tangentFamilyOf(type: SketchEntityType): TangentFamily | "line" | undefined {
    // An offset curve is no tangency target: it carries no solver params at all, so no
    // constraint can reference it and the solver never has one to name. The caller reads that
    // as "these two are not tangent" — the answer two lines get — rather than raising on a
    // pick the user is free to make.
    if (type === "offsetCurve") return undefined;
    return type === "ellipseArc" ? "ellipse" : type;
}

/** The line-curve tangency kinds: the line leads the params layout. */
const LINE_TANGENT_KINDS: Record<TangentFamily, ConstraintKind> = {
    circle: ConstraintKind.TangentLineCircle,
    arc: ConstraintKind.TangentLineArc,
    ellipse: ConstraintKind.TangentLineEllipse,
    conic: ConstraintKind.TangentLineConic,
    bezier: ConstraintKind.TangentLineBezier,
    nurbs: ConstraintKind.TangentLineNurbs,
};

/** The curve-curve tangency kinds, keyed by the family pair in rank order. */
const CURVE_TANGENT_KINDS: Record<string, ConstraintKind> = {
    "circle+circle": ConstraintKind.TangentCircleCircle,
    "circle+arc": ConstraintKind.TangentCircleArc,
    "circle+ellipse": ConstraintKind.TangentCircleEllipse,
    "circle+conic": ConstraintKind.TangentCircleConic,
    "circle+bezier": ConstraintKind.TangentCircleBezier,
    "circle+nurbs": ConstraintKind.TangentCircleNurbs,
    "arc+arc": ConstraintKind.TangentArcArc,
    "arc+ellipse": ConstraintKind.TangentArcEllipse,
    "arc+conic": ConstraintKind.TangentArcConic,
    "arc+bezier": ConstraintKind.TangentArcBezier,
    "arc+nurbs": ConstraintKind.TangentArcNurbs,
    "ellipse+ellipse": ConstraintKind.TangentEllipseEllipse,
    "ellipse+conic": ConstraintKind.TangentEllipseConic,
    "ellipse+bezier": ConstraintKind.TangentEllipseBezier,
    "ellipse+nurbs": ConstraintKind.TangentEllipseNurbs,
    "conic+conic": ConstraintKind.TangentConicConic,
    "conic+bezier": ConstraintKind.TangentConicBezier,
    "conic+nurbs": ConstraintKind.TangentConicNurbs,
    "bezier+bezier": ConstraintKind.TangentBezierBezier,
    "bezier+nurbs": ConstraintKind.TangentBezierNurbs,
    "nurbs+nurbs": ConstraintKind.TangentNurbsNurbs,
};

/** The tangency kind relating two entity types, or `undefined` for a pair that is never tangent: two lines. */
export function tangentKindFor(
    type1: SketchEntityType | undefined,
    type2: SketchEntityType | undefined,
): ConstraintKind | undefined {
    if (type1 === undefined || type2 === undefined) return undefined;
    const family1 = tangentFamilyOf(type1);
    const family2 = tangentFamilyOf(type2);
    if (family1 === undefined || family2 === undefined) return undefined;
    if (family1 === "line") return family2 === "line" ? undefined : LINE_TANGENT_KINDS[family2];
    if (family2 === "line") return LINE_TANGENT_KINDS[family1];
    const [first, second] =
        FAMILY_RANK[family1] <= FAMILY_RANK[family2] ? [family1, family2] : [family2, family1];
    return CURVE_TANGENT_KINDS[`${first}+${second}`];
}

/**
 * The kinds that can name one of the free curves (a conic, a cubic bezier or a NURBS). Their
 * refs to such a curve are the only ones a curve op has to read as anchors-or-points
 * (`isCurveAnchorRef`): every other family's kinds read their curve through refs that are
 * centers, starts and poles, and a curve op never reshapes those. The conic belongs here by
 * `isFreeCurveType` — a curve op reshapes it too, so its anchor ref has to be told from a
 * point ref exactly as a bezier's is.
 */
const FREE_CURVE_KINDS: ReadonlySet<ConstraintKind> = new Set([
    ConstraintKind.PointOnConic,
    ConstraintKind.PointOnBezier,
    ConstraintKind.PointOnNurbs,
    ConstraintKind.TangentLineConic,
    ConstraintKind.TangentLineBezier,
    ConstraintKind.TangentLineNurbs,
    ConstraintKind.TangentCircleConic,
    ConstraintKind.TangentCircleBezier,
    ConstraintKind.TangentCircleNurbs,
    ConstraintKind.TangentArcConic,
    ConstraintKind.TangentArcBezier,
    ConstraintKind.TangentArcNurbs,
    ConstraintKind.TangentEllipseConic,
    ConstraintKind.TangentEllipseBezier,
    ConstraintKind.TangentEllipseNurbs,
    ConstraintKind.TangentConicConic,
    ConstraintKind.TangentConicBezier,
    ConstraintKind.TangentConicNurbs,
    ConstraintKind.TangentBezierBezier,
    ConstraintKind.TangentBezierNurbs,
    ConstraintKind.TangentNurbsNurbs,
]);

/**
 * Whether `slot` of a constraint of `kind` is a curve's *entity anchor* — the one
 * `{entity, 0}` ref that stands for the curve itself — rather than a point on it. The
 * incidence kinds name the curve last (their first ref is the point being pinned) and the
 * line-tangency kinds name it after the line's two points; a curve-curve tangency's two
 * refs are both anchors.
 *
 * A curve op that reshapes a free curve has to tell the two apart: an anchor survives the
 * reshape — the entity is still that curve, however many control points it now has — while
 * a point ref survives only while its point is where it was.
 */
export function isCurveAnchorRef(kind: ConstraintKind, slot: number): boolean {
    if (!FREE_CURVE_KINDS.has(kind)) return false;
    if (
        kind === ConstraintKind.PointOnConic ||
        kind === ConstraintKind.PointOnBezier ||
        kind === ConstraintKind.PointOnNurbs
    )
        return slot === 1;
    if (
        kind === ConstraintKind.TangentLineConic ||
        kind === ConstraintKind.TangentLineBezier ||
        kind === ConstraintKind.TangentLineNurbs
    )
        return slot === 2;
    return true;
}

/** Two entities a tangency could relate, in the order they were picked. */
interface TangentPair {
    readonly type1: SketchEntityType;
    readonly id1: number;
    readonly type2: SketchEntityType;
    readonly id2: number;
}

/** A tangency as garlic wants it: the constraint kind and the refs that name it. */
interface TangentRefs {
    readonly kind: ConstraintKind;
    readonly refs: SketchPointRef[];
}

/**
 * The tangent constraint relating two entities, refs in the garlic params layout
 * (line endpoints first, then a circle's center, then an arc's center and start;
 * the conic/bezier/nurbs/curve-curve kinds carry one ref per curve — `{entity, 0}` — and
 * the solver expands it to the family's core params). Argument order is irrelevant;
 * `undefined` for a pair that cannot be tangent: two lines.
 */
export function tangentConstraintFor(
    type1: SketchEntityType | undefined,
    entityId1: number,
    type2: SketchEntityType | undefined,
    entityId2: number,
): TangentRefs | undefined {
    const kind = tangentKindFor(type1, type2);
    if (kind === undefined || type1 === undefined || type2 === undefined) return undefined;
    const pair: TangentPair = { type1, id1: entityId1, type2, id2: entityId2 };
    return type1 === "line" || type2 === "line" ? lineTangentRefs(kind, pair) : curveTangentRefs(kind, pair);
}

/** A tangency one of whose entities is a line — the line leading the params layout. */
function lineTangentRefs(kind: ConstraintKind, pair: TangentPair): TangentRefs {
    const [line, curve] = pair.type1 === "line" ? [pair.id1, pair.id2] : [pair.id2, pair.id1];
    // an arc names the point its radius turns on; a circle and the free curves are named by
    // their anchor alone, the solver expanding it to the family's core params
    if (kind === ConstraintKind.TangentLineArc) {
        return { kind, refs: [...lineRefs(line), centerRef(curve), arcStartRef(curve)] };
    }
    return { kind, refs: [...lineRefs(line), { entityId: curve, pointIndex: 0 }] };
}

/**
 * A tangency between two curves. The refs run in the garlic params layout's order — rank
 * order for mixed families, argument order within one family — except where the layout
 * names one side by center and start, which puts that side's refs in its own order.
 */
function curveTangentRefs(kind: ConstraintKind, pair: TangentPair): TangentRefs {
    const rank1 = FAMILY_RANK[tangentFamilyOf(pair.type1) as TangentFamily];
    const rank2 = FAMILY_RANK[tangentFamilyOf(pair.type2) as TangentFamily];
    const [firstId, secondId] = rank1 <= rank2 ? [pair.id1, pair.id2] : [pair.id2, pair.id1];
    switch (kind) {
        case ConstraintKind.TangentCircleCircle:
            return { kind, refs: [centerRef(pair.id1), centerRef(pair.id2)] };
        case ConstraintKind.TangentCircleArc: {
            const [circle, arc] = pair.type1 === "circle" ? [pair.id1, pair.id2] : [pair.id2, pair.id1];
            return { kind, refs: [centerRef(circle), centerRef(arc), arcStartRef(arc)] };
        }
        case ConstraintKind.TangentArcArc:
            return {
                kind,
                refs: [
                    centerRef(pair.id1),
                    arcStartRef(pair.id1),
                    centerRef(pair.id2),
                    arcStartRef(pair.id2),
                ],
            };
        default:
            return {
                kind,
                refs: [
                    { entityId: firstId, pointIndex: 0 },
                    { entityId: secondId, pointIndex: 0 },
                ],
            };
    }
}
