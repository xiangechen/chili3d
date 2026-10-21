// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, PubSub } from "@chili3d/core";
import {
    ConstraintKind,
    entityPointCount,
    isDimensionKind,
    isExternalEntityId,
    pointRefKey,
    SKETCH_ORIGIN_ID,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
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
 * Kinds that relate two entities to each other without carrying a reading of their own —
 * they hold a *relationship* the sketch can always reach by moving its own side, so an
 * external entity among their refs is no obstacle whatever else they name.
 *
 * The kinds *not* in here read as a value, and whether an external may take part depends
 * on what else the constraint names (`allowsConstraintOnRefs`).
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
 * Whether `entityId` may be a constraint target at all. An array's instance may not: the
 * pattern writes its parameters back on every solve, so a constraint on one would be
 * fighting the array it belongs to — the same answer SolidWorks documents for a patterned
 * instance. Nothing else is ruled out here, because what an *external* entity accepts is a
 * property of the whole constraint rather than of the one entity — that is
 * `allowsConstraintOnRefs`.
 */
export function isConstraintTarget(solver: SketchSolver, entityId: number): boolean {
    if (!solver.isDerived(entityId)) return true;
    PubSub.default.pub("showToast", "sketch.arrayInstanceReadOnly");
    return false;
}

/**
 * Whether a constraint of `kind` over `refs` may be asserted. A rejected pick pubs a toast —
 * a one-shot refusal, not one of the standing readouts the status bar carries — and returns
 * false.
 *
 * An external (projected) entity is frozen geometry: it never moves, so what a constraint
 * naming one says is satisfied by the *other* entities it names. That is why the
 * associative kinds make sense against one at all — a coincidence onto a projected corner,
 * a parallel to a projected edge — and it is just as true of a dimension, whose reading is
 * a value the sketch side moves to reach: "this point is 20 mm from that projected edge"
 * drives the point and the external is only where the measurement starts. So the rule is
 * about the whole constraint rather than about each entity, and the rigid kinds are refused
 * only when *every* entity they name is external, leaving nothing the constraint could
 * move. FreeCAD draws the same line with `areBothPointsOrSegmentsFixed`; its dimensions over
 * nothing but fixed geometry are not refused but created as references instead, which here
 * is `measuresOnlyExternalGeometry`.
 */
export function allowsConstraintOnRefs(
    solver: SketchSolver,
    kind: ConstraintKind,
    refs: readonly SketchPointRef[],
): boolean {
    if (!refs.every((ref) => isConstraintTarget(solver, ref.entityId))) return false;
    if (isAssociativeConstraintKind(kind)) return true;
    // a dimension always may: when an external is all it names, the reading is of frozen
    // geometry, and the caller places it as a reference instead of driving anything
    if (isDimensionKind(kind)) return true;
    if (refs.some((ref) => !isExternalEntityId(ref.entityId))) return true;
    PubSub.default.pub("showToast", "sketch.externalRefFrozen");
    return false;
}

/** One entity's worth of the same rule, for the commands that pick a single target. */
export function allowsConstraintOnEntity(
    solver: SketchSolver,
    kind: ConstraintKind,
    entityId: number,
): boolean {
    return allowsConstraintOnRefs(solver, kind, [{ entityId, pointIndex: 0 }]);
}

/**
 * Whether a dimension names nothing but external (projected) geometry — a reading of the
 * frozen model rather than of the sketch. Such a dimension is placed as a *reference*: there
 * is nothing on either side free to move, so asserting it would only fight the structural
 * pins the external is held by. FreeCAD creates exactly these as `driving = False`; the
 * result is the same state the user reaches by hand with `constraint.toggleDriven`.
 */
export function measuresOnlyExternalGeometry(refs: readonly SketchPointRef[]): boolean {
    return refs.length > 0 && refs.every((ref) => isExternalEntityId(ref.entityId));
}

/** Point refs addressing an entity as a line (pointIndex 0/1). */
export function lineRefs(entityId: number): SketchPointRef[] {
    return [
        { entityId, pointIndex: 0 },
        { entityId, pointIndex: 1 },
    ];
}

/** Point ref of an entity's center (pointIndex 0 of a circle, an arc or an ellipse). */
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
 * with no PointOn (a point and a text have no curve to lie on — a text's anchor is
 * its one constraint target; the datum axes pass as lines).
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

/** Incidence constraints pinning a point onto a curve. */
export const INCIDENCE_KINDS: readonly ConstraintKind[] = [
    ConstraintKind.PointOnLine,
    ConstraintKind.PointOnCircle,
    ConstraintKind.PointOnArc,
    ConstraintKind.PointOnEllipse,
    ConstraintKind.PointOnConic,
    ConstraintKind.PointOnBezier,
    ConstraintKind.PointOnNurbs,
];

/**
 * Ids of the constraints of `kinds` that pin `ref` — or a partner coincident with it — onto
 * `entityId`. The coincidence is walked because a partner stands wherever `ref` does: a
 * midpoint holding the one holds the other just as surely (the same walk `subsumedIncidenceIds`
 * makes for a coincidence).
 *
 * Partners come from `coincidentPeers`, not the drag-reading group: a point snapped onto a
 * projected edge's end *is* on that edge, and the fixed partner is exactly the one that has
 * to be seen for that to read. A partner is only a partner as a *subject*: the rows counted
 * are those whose own point it is.
 */
export function incidenceIdsOn(
    solver: SketchSolver,
    ref: SketchPointRef,
    entityId: number,
    kinds: readonly ConstraintKind[],
): number[] {
    const ids = new Set<number>();
    for (const member of solver.coincidentPeers(ref)) {
        for (const constraint of solver.constraintsOnPoint(member, kinds)) {
            // The member has to be the constraint's *subject*, and it has to be pinned onto
            // something other than its own entity (`incidenceConstraintOn` reads the pair the
            // same way): a midpoint's line may end at the picked point, and a point of the
            // entity is not held *onto* it — neither says anything about the point.
            if (pointRefKey(constraint.refs[0]) !== pointRefKey(member)) continue;
            if (member.entityId === entityId) continue;
            if (constraint.refs.some((r) => r.entityId === entityId)) ids.add(constraint.id);
        }
    }
    return [...ids];
}

/**
 * Whether the entity's own point at `pointIndex` is one its curve passes through. A size center
 * and an off-curve control point are points OF the entity without being points ON it — the two
 * the same reading tells apart in `allowsPointOnOwnEntity`.
 */
function curvePassesThrough(entity: SketchEntityData, pointIndex: number): boolean {
    return !isSizeCenter(entity, pointIndex) && !isControlHandle(entity, pointIndex);
}

/**
 * The entities a point of `target` is on by construction: the one it belongs to, and both axes
 * for the datum origin — the origin is a point of each of them the way a line's end is a point
 * of the line.
 *
 * A point the entity's own curve misses — a circle's center, a spline's inner pole — answers
 * with nothing: standing where it does puts a point of the entity nowhere near the entity. Both
 * readings of that emptiness matter, and this is the only place it is decided:
 * `subsumedIncidenceIds` then reads no row onto the entity as restated by a fuse onto such a
 * point, which nothing about the fuse makes true, and a fuse onto one is a pick the sketch
 * cannot take at all (`coincidenceRefusal`).
 */
function entitiesThePointStandsOn(solver: SketchSolver, target: SketchPointRef): number[] {
    if (target.entityId === SKETCH_ORIGIN_ID) return [SKETCH_X_AXIS_ID, SKETCH_Y_AXIS_ID];
    const entity = solver.entity(target.entityId);
    if (entity !== undefined && !curvePassesThrough(entity, target.pointIndex)) return [];
    return [target.entityId];
}

/** Whether `target` is a point standing on no entity of its own — off its own entity's curve. */
function standsOffItsOwnCurve(solver: SketchSolver, target: SketchPointRef): boolean {
    return entitiesThePointStandsOn(solver, target).length === 0;
}

/**
 * Ids of the incidences a coincidence of `first` onto `second` restates: the rows holding
 * either point — or a partner standing where it does — onto an entity the other is a point
 * of. Fusing the two puts each where the other stands, so such a row says nothing the
 * coincidence does not.
 *
 * Both ends are asked because the two picks are one statement the user may give in either
 * order, and the row may hang off either one of them: `incidenceIdsOn` walks one side, and
 * which side of the pair the user named first is not a difference between the two ways of
 * saying "these are the same point".
 */
export function subsumedIncidenceIds(
    solver: SketchSolver,
    first: SketchPointRef,
    second: SketchPointRef,
): number[] {
    const ids = new Set<number>();
    for (const [ref, target] of [
        [first, second],
        [second, first],
    ] as const) {
        for (const entityId of entitiesThePointStandsOn(solver, target)) {
            for (const id of incidenceIdsOn(solver, ref, entityId, INCIDENCE_KINDS)) ids.add(id);
        }
    }
    return [...ids];
}

/**
 * Why a coincidence of the two points may not be asserted, as the key that says so, or
 * `undefined` when it may. Both fuses it refuses hold only with one of the entities collapsed
 * to nothing, and the solve reports those as a GUARD conflict — which the panel answers with
 * "no single deletion helps", of a state where deleting either row does.
 *
 * - A midpoint already holds one point at a place of its own on the entity the other belongs
 *   to. The mirror of the pick the midpoint command refuses (`standsAtEntityPoint`), read from
 *   the other end: there a coincidence had already put the point at the entity's own point,
 *   here the midpoint has already put it somewhere else on that entity.
 * - The other point is one its own entity's curve misses — a size center, an off-curve control
 *   point — while a row holds the first on that entity. Fusing there CONTRADICTS that row
 *   rather than restating it (`entitiesThePointStandsOn` answers with no entity at all), and no
 *   reading of the sketch makes both hold: the point is on the curve and standing where the
 *   curve is not. A conic's shoulder cannot be the exception, so the pick has no answer the
 *   user could want.
 *
 * Both ends are asked: which of the two the user named first is not a difference between the
 * two ways of saying "these are the same point".
 */
export function coincidenceRefusal(
    solver: SketchSolver,
    first: SketchPointRef,
    second: SketchPointRef,
): I18nKeys | undefined {
    for (const [ref, target] of [
        [first, second],
        [second, first],
    ] as const) {
        const midpoint = entitiesThePointStandsOn(solver, target).some(
            (entityId) => incidenceIdsOn(solver, ref, entityId, [ConstraintKind.Midpoint]).length > 0,
        );
        if (midpoint) return "sketch.midpointBlocksCoincident";
        if (
            standsOffItsOwnCurve(solver, target) &&
            incidenceIdsOn(solver, ref, target.entityId, INCIDENCE_KINDS).length > 0
        ) {
            return "sketch.coincidentOffCurve";
        }
    }
    return undefined;
}

/**
 * Whether `ref` stands at a point of `entityId` itself: the picked point *is* one of the
 * line's ends, or is tied to one by a coincidence.
 *
 * A midpoint asked of such a pair has nowhere to put the point but the line's own end — the
 * constraint holds only with the line collapsed to nothing, and the solve reports that as a
 * conflict rather than a midpoint.
 */
export function standsAtEntityPoint(solver: SketchSolver, ref: SketchPointRef, entityId: number): boolean {
    return solver.coincidentPeers(ref).some((peer) => peer.entityId === entityId);
}

/**
 * Whether `ref` is a control handle of its own curve — a point the curve is pulled towards
 * rather than one it passes through: a conic's shoulder, a free curve's inner poles. The one
 * kind of self-referential point-on that constrains anything: measured, holding one onto its
 * own curve deforms the curve.
 */
function isControlHandle(entity: SketchEntityData, pointIndex: number): boolean {
    switch (entity.type) {
        case "conic":
            return pointIndex === 1;
        case "bezier":
        case "nurbs": {
            const poles = entityPointCount(entity);
            return pointIndex > 0 && pointIndex < poles - 1;
        }
        default:
            return false;
    }
}

/** Whether an entity's own point at `pointIndex` is the center its size is measured from. */
function isSizeCenter(entity: SketchEntityData, pointIndex: number): boolean {
    if (pointIndex !== 0) return false;
    return (
        entity.type === "circle" ||
        entity.type === "arc" ||
        entity.type === "ellipse" ||
        entity.type === "ellipseArc"
    );
}

/**
 * Whether a point-on of `ref` onto `entityId` says anything, when `ref` — or a partner
 * standing where it does — is one of the entity's own points. Refuses the pick (a toast) and
 * answers false for every such pick but the control handles — measured, they are the two dead
 * ends a self-referential incidence can be:
 *
 * - a point the entity's curve already passes through — a line's end, an arc's own rim, the
 *   ellipse family's axis points, a free curve's start — is on it by construction, so the
 *   constraint is a row the entity already carries. Garlic reads that as redundant, or takes
 *   dofs off the sketch without moving a thing (the ellipse family's axis points, an arc's
 *   own end), which is the worse of the two: the panel then under-reports what is left to
 *   place.
 * - the *center* of a circle, an arc or an ellipse defines its size. Held onto its own entity
 *   that size solves to nothing and the sketch comes back "Conflicting" — a circle whose
 *   center lies on its own rim is one of radius zero.
 *
 * FreeCAD arrives at the same place from the other side: it lets these through and then offers
 * `Sketcher ValidateSketch` to find the "degenerated geometry" — a zero length line, a zero
 * radius circle — they leave behind.
 */
export function allowsPointOnOwnEntity(solver: SketchSolver, ref: SketchPointRef, entityId: number): boolean {
    const entity = solver.entity(entityId);
    const standing = solver.coincidentPeers(ref);
    const own = standing.filter((peer) => peer.entityId === entityId);
    // any of the points standing there being a control handle is enough to make this that pick:
    // a shoulder recorded as coincident with the start of its own curve is still the shoulder,
    // and reading only the first one would answer by the order the records happen to be in
    if (entity === undefined || own.some((peer) => isControlHandle(entity, peer.pointIndex))) return true;
    if (own.length > 0) {
        const center = own.some((peer) => isSizeCenter(entity, peer.pointIndex));
        PubSub.default.pub("showToast", center ? "sketch.pointOnOwnCenter" : "sketch.pointOnOwnCurve");
        return false;
    }
    // the datum origin is a point of both axes by construction — the pairing `subsumedIncidenceIds`
    // reads — so holding anything standing there onto one of them restates where the sketch
    // already starts
    if (entityId !== SKETCH_X_AXIS_ID && entityId !== SKETCH_Y_AXIS_ID) return true;
    if (!standing.some((peer) => peer.entityId === SKETCH_ORIGIN_ID)) return true;
    PubSub.default.pub("showToast", "sketch.pointOnOwnCurve");
    return false;
}

/**
 * The equal constraint relating two entities of the same type: a line pair reads equal-length,
 * a circle pair equal-radius, an arc pair equal arc-radius (center and start per arc, the layout
 * the solver's `arcParams` reads). `undefined` for a type with no equality of its own — the curve
 * families: nothing about two ellipses or two splines is "equal" the way a radius is, and reading
 * one as an arc pair is what had the solver throw `Entity N is not a arc` from the middle of the
 * constraint being built.
 */
export function equalConstraintFor(
    type: SketchEntityType | undefined,
    entityId1: number,
    entityId2: number,
): { kind: ConstraintKind; refs: SketchPointRef[] } | undefined {
    switch (type) {
        case "line":
            return {
                kind: ConstraintKind.EqualLength,
                refs: [...lineRefs(entityId1), ...lineRefs(entityId2)],
            };
        case "circle":
            return { kind: ConstraintKind.EqualRadius, refs: [centerRef(entityId1), centerRef(entityId2)] };
        case "arc":
            return {
                kind: ConstraintKind.EqualArcRadius,
                refs: [
                    centerRef(entityId1),
                    arcStartRef(entityId1),
                    centerRef(entityId2),
                    arcStartRef(entityId2),
                ],
            };
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
    // constraint can reference it and the solver never has one to name. A point is none
    // either: it has no curve to be tangent along. Nor is a text: its one param pair is an
    // anchor, not a curve. The caller reads that as "these two are not tangent" — the answer
    // two lines get — rather than raising on a pick the user is free to make.
    if (type === "offsetCurve" || type === "point" || type === "text") return undefined;
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
 *
 * `ConicRho` does *not* belong here, though its one ref is the curve itself. A resize of a conic
 * changes the rho of the piece — a rational quadratic's rho is not preserved by cutting it — so a
 * user's rho would have to be re-datumed to the piece's own value, which silently replaces the
 * number they typed. Read as a point ref instead, the reshape drops the dimension with its id
 * reported (`EditOutcome.removedConstraints`), which is what the reshape path is documented to do
 * with the relations that do not survive it.
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

/** ≈0.057° — the same scale-free flavour of tolerance the solver's own degeneracy checks use. */
const PARALLEL_SINE_TOLERANCE = 1e-3;

function normalize(v: [number, number]): [number, number] | undefined {
    const length = Math.hypot(v[0], v[1]);
    return length < 1e-12 ? undefined : [v[0] / length, v[1] / length];
}

/**
 * Whether two lines run parallel — the sine of their angle, so it is scale free. Reading the
 * same direction from either line, a pair running the same way and a pair running opposite
 * ways both count.
 *
 * Anything that is not a line is no answerable pair, and neither is a line of no direction:
 * both read as not parallel, so a caller need not know what it is holding.
 */
export function areParallel(solver: SketchSolver, firstId: number, secondId: number): boolean {
    if (solver.entity(firstId)?.type !== "line" || solver.entity(secondId)?.type !== "line") {
        return false;
    }
    const [a1, a2] = [
        solver.pointOf({ entityId: firstId, pointIndex: 0 }),
        solver.pointOf({ entityId: firstId, pointIndex: 1 }),
    ];
    const [b1, b2] = [
        solver.pointOf({ entityId: secondId, pointIndex: 0 }),
        solver.pointOf({ entityId: secondId, pointIndex: 1 }),
    ];
    const da = normalize([a2[0] - a1[0], a2[1] - a1[1]]);
    const db = normalize([b2[0] - b1[0], b2[1] - b1[1]]);
    if (da === undefined || db === undefined) return false;
    return Math.abs(da[0] * db[1] - da[1] * db[0]) < PARALLEL_SINE_TOLERANCE;
}
