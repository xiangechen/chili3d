// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result } from "@chili3d/core";
import {
    ConstraintKind,
    defaultNurbsSpec,
    entityPointCount,
    pointRefKey,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
    sameEntityGeometry,
} from "./sketchModel";
import type { SketchSolver } from "./solver";
import { centerRef, lineRefs } from "./solverEntities";

/**
 * The sketch mirror: reflecting the selected entities across a line, as a *tied* copy.
 *
 * The copy is held by one `Symmetric` constraint per mirrored point pair rather than by
 * copying the selection's own constraints. That is enough to pin the copy whole — a
 * mirrored line's two symmetry constraints are exactly its four degrees of freedom, a
 * circle's center symmetry plus one `EqualRadius` are its three — so whatever relations
 * the source entities have between them (a shared corner, a tangency, a parallel) hold
 * across the reflection too, without a second constraint saying so. It is the same shape
 * Onshape and Fusion document: the copy is driven by the parent.
 *
 * Points that the source itself joins by a coincidence are the one exception, and they
 * need care in both directions. Garlic removes a coincidence by substituting its two
 * parameters for one, so two symmetries over such a pair are the *same row twice* and the
 * second reads as redundant. So the copy gets the coincidence instead — mirroring the
 * source's own structure — and one symmetry per group then holds the whole of it. That is
 * also what keeps a later drag from re-tying the pair: the auto-constraint a drag adds
 * when it lands on a point would otherwise supply exactly that coincidence, and the two
 * symmetries would collapse into one another after the fact.
 *
 * The op mirrors `cornerOps.ts` / `trimOps.ts`: pure geometry plus direct solver
 * mutation, all of it rolled back on any failure, with the caller solving and committing
 * afterwards.
 */

/**
 * A mirror axis in sketch (u, v): two distinct points of the line that carries it. A
 * datum axis answers through `solver.entity` with a synthetic line, so X and Y take
 * this path like any other line.
 */
interface MirrorAxis {
    readonly a: [number, number];
    readonly b: [number, number];
}

/** A source point and the point of the mirrored copy that reflects it. */
interface MirrorPair {
    readonly source: SketchPointRef;
    /** `pointIndex` on the copy — the copy's id is only known once it is added. */
    readonly copyIndex: number;
}

/** The mirrored copy of one entity, in the entity's own params layout. */
interface MirrorPlan {
    readonly type: SketchEntityType;
    readonly params: number[];
    readonly pairs: MirrorPair[];
    /** Whether the copy's radius is a separate param to tie to the source's (circles). */
    readonly equalRadius: boolean;
}

export interface MirrorOutcome {
    /** Ids of the mirrored copies, in source order. */
    readonly createdEntityIds: number[];
    /**
     * Sources left out because they are already symmetric about the axis — a line lying
     * along it, a line it bisects, a circle centered on it, an arc whose span mirrors
     * onto itself. Reflecting one would only duplicate it onto itself, and two
     * coincident edges do not make a profile.
     */
    readonly skippedSelfMirror: number[];
}

/** The reflection of `point` across the line through `a` and `b`. */
export function reflectPoint(
    point: readonly [number, number],
    a: readonly [number, number],
    b: readonly [number, number],
): [number, number] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy);
    const foot: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    return [2 * foot[0] - point[0], 2 * foot[1] - point[1]];
}

/** The two endpoints of the mirror line, or an error when it is not one. */
function axisOf(solver: SketchSolver, axisId: number): Result<MirrorAxis> {
    const line = solver.entity(axisId);
    if (line === undefined || line.type !== "line") {
        return Result.err("The mirror line must be a line");
    }
    const [x1, y1, x2, y2] = line.params;
    if (Math.hypot(x2 - x1, y2 - y1) <= Precision.Distance) {
        return Result.err("The mirror line is too short to mirror about");
    }
    return Result.ok({ a: [x1, y1], b: [x2, y2] });
}

/** A reflection of one point in the plane, as `planMirror` passes it down to its helpers. */
type Reflect = (point: readonly [number, number]) => [number, number];

/**
 * The copy of one entity: its reflected params, and the point pairs that tie them
 * together.
 *
 * Most entities are just their points: a reflection moves those and leaves everything
 * else alone — a circle's radius, a conic's rho and a NURBS' weights are not points, and
 * `pointPlan` carries them through untouched. Two entities say more. An arc's rim points
 * trade places, because a reflection reverses orientation and the mirrored span only reads
 * counter-clockwise with them exchanged. An ellipseArc's do not: its sweep is measured in
 * its own frame, and the mirrored frame is left-handed, so the frame itself carries the
 * flip and the rim points keep their places (swapping them would draw the complement). A
 * conic equally keeps its pole order — a bezier's direction is its poles', not the
 * plane's — and its knots are outside the params altogether.
 */
function planMirror(entity: SketchEntityData, axis: MirrorAxis): MirrorPlan {
    const reflect: Reflect = (point) => reflectPoint(point, axis.a, axis.b);
    switch (entity.type) {
        case "line":
            return pointPlan(entity, 2, reflect);
        case "circle":
            return { ...pointPlan(entity, 1, reflect), equalRadius: true };
        case "ellipse":
            return pointPlan(entity, 3, reflect);
        case "conic":
            return pointPlan(entity, 3, reflect);
        case "arc": {
            // the reflected arc runs counter-clockwise from the image of the source's END
            const center = reflect([entity.params[0], entity.params[1]]);
            const start = reflect([entity.params[2], entity.params[3]]);
            const end = reflect([entity.params[4], entity.params[5]]);
            return {
                type: "arc",
                params: [...center, ...end, ...start],
                pairs: mirrorPairs(entity.id, 3, [1, 2]),
                equalRadius: false,
            };
        }
        case "ellipseArc": {
            const frame = chunkPoints(entity.params, 3).flatMap(reflect);
            const start = reflect([entity.params[6], entity.params[7]]);
            const end = reflect([entity.params[8], entity.params[9]]);
            return {
                type: "ellipseArc",
                params: [...frame, ...start, ...end],
                pairs: mirrorPairs(entity.id, 5),
                equalRadius: false,
            };
        }
        default:
            // the free curves — a cubic bezier or a NURBS: every control point reflected
            return pointPlan(entity, entityPointCount(entity), reflect);
    }
}

/**
 * The plan for an entity that reflects point by point: its first `count` point slots
 * mirrored, and every param past them — a radius, a rho, a NURBS' weights — carried
 * through as it is.
 */
function pointPlan(entity: SketchEntityData, count: number, reflect: Reflect): MirrorPlan {
    return {
        type: entity.type,
        params: [...chunkPoints(entity.params, count).flatMap(reflect), ...entity.params.slice(count * 2)],
        pairs: mirrorPairs(entity.id, count),
        equalRadius: false,
    };
}

/**
 * The point pairs of a copy: source point `i` answers copy point `i`, except that `swap`
 * names two that trade places (an arc's rim points, see `planMirror`).
 */
function mirrorPairs(entityId: number, count: number, swap?: [number, number]): MirrorPair[] {
    const pairs: MirrorPair[] = [];
    for (let pointIndex = 0; pointIndex < count; pointIndex++) {
        let copyIndex = pointIndex;
        if (swap !== undefined && pointIndex === swap[0]) copyIndex = swap[1];
        else if (swap !== undefined && pointIndex === swap[1]) copyIndex = swap[0];
        pairs.push({ source: { entityId, pointIndex }, copyIndex });
    }
    return pairs;
}

/** The params' point slots as coordinate pairs: the first `count` pairs of the params. */
function chunkPoints(params: readonly number[], count: number): [number, number][] {
    const points: [number, number][] = [];
    for (let i = 0; i < count; i++) {
        points.push([params[i * 2], params[i * 2 + 1]]);
    }
    return points;
}

/** A source entity eligible to be mirrored: real geometry of a kind the solver can reflect. */
function isMirrorable(entity: SketchEntityData | undefined): entity is SketchEntityData {
    return (
        entity !== undefined &&
        ["line", "circle", "arc", "ellipse", "ellipseArc", "conic", "bezier", "nurbs"].includes(entity.type)
    );
}

/** A source to mirror, with the copy already worked out. */
interface PlannedSource {
    readonly entity: SketchEntityData;
    readonly plan: MirrorPlan;
}

/**
 * How close a copy has to land on existing geometry to count as a duplicate of it. This
 * is the profile builder's own coincidence (`Precision.Distance`), not a look-close
 * distance: a copy merely near another edge is still an edge the user asked for.
 */
const DUPLICATE_TOLERANCE = Precision.Distance;

/**
 * The sources worth mirroring, and the ones left out because a copy of them is already
 * in the sketch — either the source is its own mirror (see `sameEntityGeometry`) or the
 * selection contains the reflection of it, which is what a shape that is itself
 * symmetric about the axis looks like. The caller reports those so a skipped pick never
 * looks like a silent failure.
 *
 * Leaving them out is not tidiness: a copy laid exactly over an existing edge duplicates
 * it, and the profile builder falls back to the kernel path for the whole sketch as soon
 * as it finds any overlapping pair (`needsKernelSplit`). It also keeps the symmetry
 * constraints honest — two sources that mirror onto each other land their copies on each
 * other, and the rows those constraints produce collapse.
 *
 * Datum and external entities drop out entirely: neither is real geometry the solver may
 * move, and an external would need its own republished data.
 */
function planSources(
    solver: SketchSolver,
    sourceIds: readonly number[],
    axisId: number,
    axis: MirrorAxis,
    tolerance: number,
): { planned: PlannedSource[]; skippedSelfMirror: number[] } {
    const planned: PlannedSource[] = [];
    const skippedSelfMirror: number[] = [];
    // what the sketch already shows, plus every copy accepted so far — a copy landing on
    // any of it is a duplicate
    const present: { type: SketchEntityType; params: readonly number[] }[] = solver
        .entities()
        .map((entity) => ({ type: entity.type, params: entity.params }));
    for (const id of new Set(sourceIds)) {
        // the axis is not a source: mirroring it about itself is nothing
        if (id === axisId || solver.isFixed(id)) continue;
        const entity = solver.entity(id);
        if (!isMirrorable(entity)) continue;
        const plan = planMirror(entity, axis);
        // Its own mirror is judged with the caller's tolerance, so an entity merely near
        // the axis goes too — its copy would lie on top of it all the same. Duplicating
        // *other* geometry is judged by coincidence instead: a copy that lands near
        // another edge is still an edge the user asked for.
        const ontoItself = sameEntityGeometry(entity.type, entity.params, plan.type, plan.params, tolerance);
        const ontoOthers = present.some((other) =>
            sameEntityGeometry(other.type, other.params, plan.type, plan.params, DUPLICATE_TOLERANCE),
        );
        if (ontoItself || ontoOthers) {
            skippedSelfMirror.push(id);
            continue;
        }
        planned.push({ entity, plan });
        present.push({ type: plan.type, params: plan.params });
    }
    return { planned, skippedSelfMirror };
}

/**
 * Mirrors `sourceIds` across `axisId`, adding the copies and the constraints that tie
 * them to their sources. `tolerance` is in sketch units and decides what counts as
 * already symmetric about the axis (see `sameEntityGeometry`); the caller passes its
 * screen tolerance, floored, as the corner commands do.
 *
 * The caller solves and commits: this op solves once itself, only so a copy the solver
 * cannot hold is rolled back here rather than left half-applied in the sketch.
 */
export function mirrorEntities(
    solver: SketchSolver,
    sourceIds: readonly number[],
    axisId: number,
    tolerance: number,
): Result<MirrorOutcome> {
    const axis = axisOf(solver, axisId);
    if (!axis.isOk) return Result.err(axis.error);

    const tol = Math.max(tolerance, 1e-6);
    const { planned, skippedSelfMirror } = planSources(solver, sourceIds, axisId, axis.value, tol);
    // Nothing eligible is an error; everything eligible being its own mirror is not —
    // that is a real answer, and the caller reports which entities it covered.
    if (planned.length === 0 && skippedSelfMirror.length === 0) return Result.err("Nothing to mirror");
    if (planned.length === 0) return Result.ok({ createdEntityIds: [], skippedSelfMirror });

    const snapshot = solver.toData();
    const copies = planned.map(({ entity, plan }) => ({
        entity,
        plan,
        copyId: addCopy(solver, entity, plan),
    }));
    addTies(solver, copies, lineRefs(axisId));

    const outcome = solver.solve(true);
    if (outcome.result === "Conflicting" || outcome.result === "Diverged" || outcome.result === "Stalled") {
        solver.reset(snapshot);
        return Result.err(`The sketch could not solve after the mirror (${outcome.result})`);
    }
    return Result.ok({ createdEntityIds: copies.map((copy) => copy.copyId), skippedSelfMirror });
}

/** A mirrored copy: the entity it answers, the plan it came from, and its new id. */
interface MirroredCopy {
    readonly entity: SketchEntityData;
    readonly plan: MirrorPlan;
    readonly copyId: number;
}

/** Adds one mirrored copy's geometry and keeps its construction flag; the ties come after. */
function addCopy(solver: SketchSolver, entity: SketchEntityData, plan: MirrorPlan): number {
    // the source's own knots: a reflection moves the control points, not the curve's
    // structure. `entity()` always carries them for a NURBS, the fallback being the
    // same clamped uniform default the evaluation falls back to
    const nurbs = entity.nurbs ?? defaultNurbsSpec(entityPointCount(entity));
    const copyId = solver.addEntityFromParams(plan.type, plan.params, nurbs);
    if (solver.isConstruction(entity.id)) solver.setConstruction(copyId, true);
    return copyId;
}

/** A source point and the copy point it reflects. */
interface MirroredPair {
    readonly source: SketchPointRef;
    readonly copy: SketchPointRef;
}

/** Every mirrored point pair, with the copy's id now known. */
function mirroredPairs(copies: readonly MirroredCopy[]): MirroredPair[] {
    return copies.flatMap(({ plan, copyId }) =>
        plan.pairs.map((pair) => ({
            source: pair.source,
            copy: { entityId: copyId, pointIndex: pair.copyIndex },
        })),
    );
}

/**
 * The source points the sketch joins by a coincidence, grouped — one entry per group,
 * each holding only points of the selection. A point in no group comes back as a group
 * of its own, so callers can tell "joined to something selected" from "alone" by length.
 */
function coincidentGroups(solver: SketchSolver, refs: readonly SketchPointRef[]): SketchPointRef[][] {
    const selected = new Set(refs.map(pointRefKey));
    const grouped = new Set<string>();
    const groups: SketchPointRef[][] = [];
    for (const ref of refs) {
        if (grouped.has(pointRefKey(ref))) continue;
        const group = solver.coincidentGroup(ref).filter((r) => selected.has(pointRefKey(r)));
        for (const member of group) grouped.add(pointRefKey(member));
        groups.push(group);
    }
    return groups;
}

/**
 * Ties every copy to its source: a symmetry per mirrored point pair, a radius equality
 * per mirrored circle, and the selection's own coincidences mirrored so the copy keeps
 * the source's structure. Points a coincidence already joins share one symmetry — see the
 * module header for why the second one would be a duplicate row.
 */
function addTies(
    solver: SketchSolver,
    copies: readonly MirroredCopy[],
    axisRefs: readonly SketchPointRef[],
): void {
    const pairs = mirroredPairs(copies);
    const copyOf = new Map(pairs.map((pair) => [pointRefKey(pair.source), pair.copy]));
    const groups = coincidentGroups(
        solver,
        pairs.map((pair) => pair.source),
    );
    tieSymmetries(solver, pairs, groups, axisRefs);
    tieCopySizes(solver, copies);
    tieMirroredCoincidences(solver, groups, copyOf);
}

/**
 * A symmetry per mirrored point pair — except that points a coincidence already joins
 * share one symmetry, since garlic spells such a pair as a single parameter and the second
 * row would be the first over again (see the module header).
 */
function tieSymmetries(
    solver: SketchSolver,
    pairs: readonly MirroredPair[],
    groups: readonly SketchPointRef[][],
    axisRefs: readonly SketchPointRef[],
): void {
    // the first point of a group stands for all of it
    const headOf = new Map<string, string>();
    for (const group of groups) {
        for (const member of group) headOf.set(pointRefKey(member), pointRefKey(group[0]));
    }
    for (const { source, copy } of pairs) {
        const head = headOf.get(pointRefKey(source));
        // a point in no group is a head of itself: the map has nothing for it
        if (head === undefined || head === pointRefKey(source)) {
            solver.addConstraint({ kind: ConstraintKind.Symmetric, refs: [source, copy, ...axisRefs] });
        }
    }
}

/**
 * The sizes a point symmetry leaves free. A circle's radius and a conic's rho are params of
 * their own, which the symmetries never reach, so each copy is pinned to its source's value
 * the same way an offset keeps the size it was created with.
 */
function tieCopySizes(solver: SketchSolver, copies: readonly MirroredCopy[]): void {
    for (const { entity, plan, copyId } of copies) {
        if (plan.equalRadius) {
            solver.addConstraint({
                kind: ConstraintKind.EqualRadius,
                refs: [centerRef(entity.id), centerRef(copyId)],
            });
        }
        if (plan.type === "conic") {
            solver.addConstraint({
                kind: ConstraintKind.ConicRho,
                refs: [{ entityId: copyId, pointIndex: 0 }],
                datum: entity.params[6],
            });
        }
    }
}

/**
 * The copy keeps the source's own structure, so a point the source joins stays joined —
 * and a later drag has nothing left to add.
 */
function tieMirroredCoincidences(
    solver: SketchSolver,
    groups: readonly SketchPointRef[][],
    copyOf: ReadonlyMap<string, SketchPointRef>,
): void {
    for (const group of groups) {
        const head = copyOf.get(pointRefKey(group[0]));
        if (head === undefined) continue;
        for (const member of group.slice(1)) {
            const memberCopy = copyOf.get(pointRefKey(member));
            if (memberCopy !== undefined) {
                solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [head, memberCopy] });
            }
        }
    }
}

/**
 * The meshes-to-be of a mirror, as entity data in sketch coordinates — the preview and
 * the op decide the copied geometry through the same `planMirror`, so a preview can
 * never show a copy the op would not make. The ids are the sources' own: nothing
 * addresses a preview copy, it is only ever meshed.
 */
export function mirrorPreview(
    solver: SketchSolver,
    sourceIds: readonly number[],
    axisId: number,
    tolerance: number,
): SketchEntityData[] {
    const axis = axisOf(solver, axisId);
    if (!axis.isOk) return [];
    const tol = Math.max(tolerance, 1e-6);
    const { planned } = planSources(solver, sourceIds, axisId, axis.value, tol);
    return planned.map(({ entity, plan }) => ({
        id: entity.id,
        type: plan.type,
        params: plan.params,
        ...(solver.isConstruction(entity.id) ? { construction: true } : {}),
    }));
}
