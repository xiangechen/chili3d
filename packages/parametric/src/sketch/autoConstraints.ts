// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "@chili3d/core";
import {
    arcAngles,
    axisLineRefs,
    ConstraintKind,
    datumEntityData,
    entityPointCount,
    entityRadius,
    isDatumEntityId,
    originRef,
    pointRefKey,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver } from "./solver";
import {
    arcStartRef,
    centerRef,
    constraintTargetEntities,
    tangentConstraintFor,
    tangentKindFor,
} from "./solverEntities";

const DEFAULT_ANGLE_TOLERANCE_DEG = 5;

/** Incidence constraints pinning a point onto a curve (line/circle/arc). */
const INCIDENCE_KINDS: readonly ConstraintKind[] = [
    ConstraintKind.PointOnLine,
    ConstraintKind.PointOnCircle,
    ConstraintKind.PointOnArc,
];

export interface AutoConstraintOptions {
    /** Snap distance (sketch-plane units) for endpoint-on-endpoint coincidence. */
    pointTolerance: number;
    /** Snap distance for point-on-curve (line, axis, circle, arc); defaults to `pointTolerance`. */
    lineTolerance?: number;
    /** A line within this angle of an axis gets a Horizontal/Vertical constraint. */
    angleToleranceDeg?: number;
}

/**
 * Point refs of an entity that participate in snapping: every point it exposes —
 * line endpoints, circle center, arc center/start/end. The centers snap like any
 * other point, so a circle drawn onto a center is concentric by constraint.
 */
function snappablePointIndices(type: SketchEntityType): number[] {
    return Array.from({ length: entityPointCount(type) }, (_, pointIndex) => pointIndex);
}

/**
 * Whether `ref` is already pinned to a curve by an incidence constraint. The arc's
 * own structural PointOnArc does not count — it pins the point to nothing but the
 * arc it already belongs to.
 */
function hasIncidence(solver: SketchSolver, ref: SketchPointRef): boolean {
    return solver.hasIncidenceOn(ref, INCIDENCE_KINDS);
}

/**
 * Applies automatic constraints to a freshly created entity:
 * - every point it exposes (line endpoints, circle center, arc center/start/end)
 *   near the origin or an existing point is snapped onto it and coincident-linked;
 * - a point not so snapped that sits near an existing line, circle, arc or the
 *   sketch axes is snapped onto it with the matching incidence constraint;
 * - near-horizontal / near-vertical lines get a Horizontal / Vertical constraint;
 * - an entity already (near-)tangent to a line, circle, arc or axis gets the
 *   matching tangent constraint.
 * Returns the added constraints. Call `solve` afterwards.
 */
export function applyAutoConstraints(
    solver: SketchSolver,
    entityId: number,
    options: AutoConstraintOptions,
): Omit<SketchConstraintData, "id">[] {
    const added: Omit<SketchConstraintData, "id">[] = [];
    const entity = solver.entities().find((x) => x.id === entityId);
    if (entity === undefined) return added;

    const refs: SketchPointRef[] = snappablePointIndices(entity.type).map((pointIndex) => ({
        entityId,
        pointIndex,
    }));

    const curveTolerance = options.lineTolerance ?? options.pointTolerance;
    snapToExistingPoints(solver, refs, options.pointTolerance, added);
    snapToExistingLines(solver, refs, curveTolerance, added);
    snapToExistingCurves(solver, refs, curveTolerance, added);
    if (entity.type === "line") {
        alignToAxis(
            solver,
            refs as [SketchPointRef, SketchPointRef],
            options.angleToleranceDeg ?? DEFAULT_ANGLE_TOLERANCE_DEG,
            added,
        );
    }
    snapToTangency(solver, entityId, options.pointTolerance, added);
    return added;
}

/**
 * A magnetic snap target for a dragged point: the geometry the position resolves
 * onto, with the point refs the matching incidence constraint is built from.
 */
export type DragSnap =
    | { kind: "point"; point: SketchPointRef; position: [number, number] }
    | { kind: "line"; lineRefs: [SketchPointRef, SketchPointRef]; position: [number, number] }
    | { kind: "circle"; circleRef: SketchPointRef; position: [number, number] }
    | { kind: "arc"; arcRefs: [SketchPointRef, SketchPointRef]; position: [number, number] };

/** Result of a magnetic snap probe: the position to resolve to, plus the target for feedback. */
export interface DragSnapResult {
    position: [number, number];
    /** The snap target, undefined when nothing snapped. */
    snap?: DragSnap;
    /**
     * Tangency the probe's own entity would be given — the hint shows this icon in
     * place of the snap's, see `snapPosition`.
     */
    tangentKind?: ConstraintKind;
}

/** The constraint a snapped point would add, refs in garlic's layout. */
export function snapConstraint(ref: SketchPointRef, snap: DragSnap): Omit<SketchConstraintData, "id"> {
    const kind = snapConstraintKind(snap);
    switch (snap.kind) {
        case "point":
            return { kind, refs: [ref, snap.point] };
        case "line":
            return { kind, refs: [ref, ...snap.lineRefs] };
        case "circle":
            return { kind, refs: [ref, snap.circleRef] };
        case "arc":
            return { kind, refs: [ref, ...snap.arcRefs] };
    }
}

/** The constraint kind a snap adds — what the feedback badge shows. */
export function snapConstraintKind(snap: DragSnap): ConstraintKind {
    return SNAP_KINDS[snap.kind];
}

const SNAP_KINDS: Record<DragSnap["kind"], ConstraintKind> = {
    point: ConstraintKind.P2PCoincident,
    line: ConstraintKind.PointOnLine,
    circle: ConstraintKind.PointOnCircle,
    arc: ConstraintKind.PointOnArc,
};

/**
 * The entity a snap highlights, or undefined for a snapped point: it marks the
 * spot itself rather than the geometry it lands on.
 */
export function snapTargetEntityId(snap: DragSnap): number | undefined {
    switch (snap.kind) {
        case "point":
            return undefined;
        case "line":
            return snap.lineRefs[0].entityId;
        case "circle":
            return snap.circleRef.entityId;
        case "arc":
            return snap.arcRefs[0].entityId;
    }
}

/**
 * Magnetic snap probe for a point dragged to `target`: the nearest existing point,
 * line/axis or circle/arc within tolerance. Purely positional — no constraint is
 * added; pass `position` to `dragTo` for live feedback, use `snap` to highlight
 * the target, and call `applyDragAutoConstraints` once the drag settles to make
 * the snap stick.
 */
export function dragSnapPosition(
    solver: SketchSolver,
    ref: SketchPointRef,
    target: [number, number],
    options: AutoConstraintOptions,
): DragSnapResult {
    const snap = findDragSnap(solver, ref, target, options);
    return snap === undefined ? { position: target } : { position: snap.position, snap };
}

/**
 * The entity a probe would complete, in sketch uv — the subject of the drawing
 * hint's tangency check. It has no id: nothing of it exists in the solver yet.
 */
export interface TentativeEntity {
    type: SketchEntityType;
    params: number[];
}

/**
 * Snaps an arbitrary probe position (a point being drawn) to the nearest existing
 * point/origin, line/axis or circle/arc. `tentative` hands over the entity the
 * probe would complete, which is judged for tangency: `tangentKind` comes back set
 * when that entity would be given a tangent constraint, for the hint to show the
 * tangent icon in place of the snap's own. Used by the drawing commands' point
 * step for live snap feedback before the entity is committed.
 */
export function snapPosition(
    solver: SketchSolver,
    probe: [number, number],
    options: AutoConstraintOptions,
    tentative?: (position: [number, number]) => TentativeEntity | undefined,
): DragSnapResult {
    // one enumeration per probe: the table is passed down to every snap helper
    const entities = constraintTargetEntities(solver);
    let snap: DragSnap | undefined;
    if (options.pointTolerance > 0) {
        const nearest = nearestCandidate(snapCandidates(solver, entities), probe, options.pointTolerance);
        if (nearest !== undefined) snap = { kind: "point", point: nearest.ref, position: nearest.position };
    }

    const lineTolerance = options.lineTolerance ?? options.pointTolerance;
    if (snap === undefined && lineTolerance > 0) {
        const nearest = nearestLineOrAxisSnap(solver, entities, undefined, probe, lineTolerance);
        if (nearest !== undefined)
            snap = { kind: "line", lineRefs: nearest.lineRefs, position: nearest.position };
        else snap = nearestCurveSnap(entities, undefined, probe, lineTolerance);
    }

    const position = snap === undefined ? probe : snap.position;
    const entity = tentative?.(position);
    const tangentKind =
        entity === undefined
            ? undefined
            : nearestTangency(solver, { id: TENTATIVE_ENTITY_ID, ...entity }, options.pointTolerance)?.kind;
    return { position, snap, tangentKind };
}

/**
 * Id of a tentative entity: no real id is ever 0 (they count up from 1, the datum
 * and externals count down), so the candidate list excludes nothing for it.
 */
const TENTATIVE_ENTITY_ID = 0;

/**
 * Settles a just-finished drag: if the point is still near an existing point,
 * line/axis or circle/arc, adds the matching incidence constraint and snaps the
 * point onto it. Returns the added constraints. Call `solve` afterwards.
 */
export function applyDragAutoConstraints(
    solver: SketchSolver,
    ref: SketchPointRef,
    options: AutoConstraintOptions,
): Omit<SketchConstraintData, "id">[] {
    return applyPointAutoConstraints(solver, [ref], [ref.entityId], options);
}

/**
 * Applies automatic incidence constraints to freshly created points that belong to
 * a shape built from several entities at once (the rectangle's two diagonal
 * corners). `excludeEntityIds` lists the shape's own entities so its corners never
 * snap onto each other's edges. Returns the added constraints. Call `solve` afterwards.
 */
export function applyPointAutoConstraints(
    solver: SketchSolver,
    refs: SketchPointRef[],
    excludeEntityIds: number[],
    options: AutoConstraintOptions,
): Omit<SketchConstraintData, "id">[] {
    const excluded = new Set(excludeEntityIds);
    const added: Omit<SketchConstraintData, "id">[] = [];
    for (const ref of refs) {
        const snap = findPointSnap(solver, ref, solver.pointOf(ref), excluded, options);
        if (snap === undefined) continue;
        // a point already coincident with the datum origin is re-snapped harmlessly
        if (snap.kind === "point" && solver.hasConstraint(ConstraintKind.P2PCoincident, [ref, snap.point])) {
            continue;
        }

        const constraint = snapConstraint(ref, snap);
        solver.setPointPosition(ref, snap.position[0], snap.position[1]);
        solver.addConstraint(constraint);
        added.push(constraint);
    }
    return added;
}

/** Nearest snap for a dragged point (its own entity excluded), or undefined. */
function findDragSnap(
    solver: SketchSolver,
    ref: SketchPointRef,
    probe: [number, number],
    options: AutoConstraintOptions,
): DragSnap | undefined {
    return findPointSnap(solver, ref, probe, new Set([ref.entityId]), options);
}

/**
 * Nearest snap for a point, excluding `excludeEntityIds`, or undefined. Points win
 * over curves, real lines and axes over circles and arcs — the same precedence the
 * drawing feedback shows.
 */
function findPointSnap(
    solver: SketchSolver,
    ref: SketchPointRef,
    probe: [number, number],
    excludeEntityIds: ReadonlySet<number> | undefined,
    options: AutoConstraintOptions,
): DragSnap | undefined {
    // one enumeration per probe (per pointer event during a drag): the helpers
    // below only read the table, and positions are read live via solver.pointOf
    const entities = constraintTargetEntities(solver);
    if (options.pointTolerance > 0) {
        const snap = nearestPointSnap(solver, entities, ref, probe, excludeEntityIds, options.pointTolerance);
        if (snap !== undefined) return { kind: "point", point: snap.ref, position: snap.position };
    }

    const curveTolerance = options.lineTolerance ?? options.pointTolerance;
    if (curveTolerance <= 0 || hasIncidence(solver, ref)) return undefined;
    const line = nearestLineOrAxisSnap(solver, entities, excludeEntityIds, probe, curveTolerance);
    if (line !== undefined) return { kind: "line", lineRefs: line.lineRefs, position: line.position };
    return nearestCurveSnap(entities, excludeEntityIds, probe, curveTolerance);
}

interface SnapCandidate {
    ref: SketchPointRef;
    position: [number, number];
}

function snapToExistingPoints(
    solver: SketchSolver,
    refs: SketchPointRef[],
    tolerance: number,
    added: Omit<SketchConstraintData, "id">[],
): void {
    if (tolerance <= 0) return;
    const candidates = snapCandidates(solver, constraintTargetEntities(solver), refs[0].entityId);

    for (const ref of refs) {
        const nearest = nearestCandidate(candidates, solver.pointOf(ref), tolerance);
        if (nearest === undefined || collapsesOntoSibling(solver, refs, ref, nearest.position)) continue;

        solver.setPointPosition(ref, nearest.position[0], nearest.position[1]);
        const constraint = { kind: ConstraintKind.P2PCoincident, refs: [ref, nearest.ref] };
        solver.addConstraint(constraint);
        added.push(constraint);
    }
}

function snapToExistingLines(
    solver: SketchSolver,
    refs: SketchPointRef[],
    tolerance: number,
    added: Omit<SketchConstraintData, "id">[],
): void {
    if (tolerance <= 0) return;
    // the entity set cannot change inside the loop (only point positions move,
    // and those are read live via solver.pointOf), so enumerate it once
    const entities = constraintTargetEntities(solver);
    for (const ref of refs) {
        // a point snap (or an existing incidence) already anchors this point
        if (
            solver.constraintKindsOnPoint(ref).includes(ConstraintKind.P2PCoincident) ||
            hasIncidence(solver, ref)
        ) {
            continue;
        }
        const snap = nearestLineOrAxisSnap(
            solver,
            entities,
            new Set([ref.entityId]),
            solver.pointOf(ref),
            tolerance,
        );
        if (snap === undefined) continue;

        solver.setPointPosition(ref, snap.position[0], snap.position[1]);
        const constraint = { kind: ConstraintKind.PointOnLine, refs: [ref, ...snap.lineRefs] };
        solver.addConstraint(constraint);
        added.push(constraint);
    }
}

/** Snaps a point near an existing circle or arc onto its curve with a point-on-circle/arc constraint. */
function snapToExistingCurves(
    solver: SketchSolver,
    refs: SketchPointRef[],
    tolerance: number,
    added: Omit<SketchConstraintData, "id">[],
): void {
    if (tolerance <= 0) return;
    const entities = constraintTargetEntities(solver);
    for (const ref of refs) {
        // a point snap (or an existing incidence) already anchors this point
        if (
            solver.constraintKindsOnPoint(ref).includes(ConstraintKind.P2PCoincident) ||
            hasIncidence(solver, ref)
        ) {
            continue;
        }
        const snap = nearestCurveSnap(entities, new Set([ref.entityId]), solver.pointOf(ref), tolerance);
        // a point landing where a sibling point already sits would collapse the entity
        if (snap === undefined || collapsesOntoSibling(solver, refs, ref, snap.position)) continue;

        solver.setPointPosition(ref, snap.position[0], snap.position[1]);
        const constraint = snapConstraint(ref, snap);
        solver.addConstraint(constraint);
        added.push(constraint);
    }
}

/**
 * Closest circle or arc (real or external) whose curve passes within `tolerance`
 * of the probe, or undefined. An arc only counts where it is actually drawn: a
 * probe beside its circle outside the sweep snaps to nothing.
 */
function nearestCurveSnap(
    entities: SketchEntityData[],
    excludeEntityIds: ReadonlySet<number> | undefined,
    probe: [number, number],
    tolerance: number,
): DragSnap | undefined {
    let nearest: { distance: number; snap: DragSnap } | undefined;
    for (const entity of entities) {
        if (excludeEntityIds?.has(entity.id) || entity.type === "line") continue;
        const projection = projectOntoEntity(entity, probe);
        if (projection === undefined || projection.distance >= tolerance) continue;
        if (nearest !== undefined && projection.distance >= nearest.distance) continue;
        nearest = { distance: projection.distance, snap: curveSnap(entity, projection.position) };
    }
    return nearest?.snap;
}

/** The snap onto `entity`'s curve, with the refs `PointOnCircle`/`PointOnArc` are built from. */
function curveSnap(entity: SketchEntityData, position: [number, number]): DragSnap {
    return entity.type === "circle"
        ? { kind: "circle", circleRef: centerRef(entity.id), position }
        : { kind: "arc", arcRefs: [centerRef(entity.id), arcStartRef(entity.id)], position };
}

/**
 * Nearest point of a circle/arc entity's curve to the probe — the radial
 * projection, undefined at the center (no radial direction) and off an arc's
 * sweep.
 */
function projectOntoEntity(
    entity: SketchEntityData,
    [u, v]: [number, number],
): { position: [number, number]; distance: number } | undefined {
    const [cx, cy] = entity.params;
    const dx = u - cx;
    const dy = v - cy;
    const centerDistance = Math.hypot(dx, dy);
    if (centerDistance < Precision.Distance) return undefined;

    const radius = entityRadius(entity);
    const position: [number, number] = [
        cx + (dx / centerDistance) * radius,
        cy + (dy / centerDistance) * radius,
    ];
    if (!contactVisible(entity, position)) return undefined;
    return { position, distance: Math.abs(centerDistance - radius) };
}

/**
 * Snap targets: every snappable point of the other entities (real and external),
 * plus the origin (last, so a real point wins ties).
 */
function snapCandidates(
    solver: SketchSolver,
    entities: SketchEntityData[],
    excludeEntityId?: number,
): SnapCandidate[] {
    const candidates: SnapCandidate[] = entities
        .filter((e) => excludeEntityId === undefined || e.id !== excludeEntityId)
        .flatMap((e) =>
            snappablePointIndices(e.type).map((pointIndex) => {
                const ref = { entityId: e.id, pointIndex };
                return { ref, position: solver.pointOf(ref) };
            }),
        );
    candidates.push({ ref: originRef(), position: [0, 0] });
    return candidates;
}

/**
 * Snap targets for a dragged point: other entities' points (real and external)
 * plus the origin, minus excluded entities and the coincident group.
 */
function nearestPointSnap(
    solver: SketchSolver,
    entities: SketchEntityData[],
    ref: SketchPointRef,
    target: [number, number],
    excludeEntityIds: ReadonlySet<number> | undefined,
    tolerance: number,
): SnapCandidate | undefined {
    const excluded = new Set(solver.coincidentGroup(ref).map(pointRefKey));
    excluded.add(pointRefKey(ref));

    const candidates: SnapCandidate[] = [];
    for (const entity of entities) {
        if (excludeEntityIds?.has(entity.id)) continue;
        for (const pointIndex of snappablePointIndices(entity.type)) {
            const candidateRef = { entityId: entity.id, pointIndex };
            if (excluded.has(pointRefKey(candidateRef))) continue;
            candidates.push({ ref: candidateRef, position: solver.pointOf(candidateRef) });
        }
    }
    candidates.push({ ref: originRef(), position: [0, 0] });
    return nearestCandidate(candidates, target, tolerance);
}

interface LineSnap {
    lineRefs: [SketchPointRef, SketchPointRef];
    position: [number, number];
    distance: number;
}

/** Closest line or datum axis within `tolerance` of the probe, real lines winning ties. */
function nearestLineOrAxisSnap(
    solver: SketchSolver,
    entities: SketchEntityData[],
    excludeEntityIds: ReadonlySet<number> | undefined,
    probe: [number, number],
    tolerance: number,
): LineSnap | undefined {
    const line = nearestLineSnap(solver, entities, excludeEntityIds, probe, tolerance);
    const axis = nearestAxisSnap(probe, tolerance);
    if (axis === undefined) return line;
    if (line === undefined) return axis;
    return line.distance <= axis.distance ? line : axis;
}

/** Closest line (real or external) whose segment passes within `tolerance` of the probe, or undefined. */
function nearestLineSnap(
    solver: SketchSolver,
    entities: SketchEntityData[],
    excludeEntityIds: ReadonlySet<number> | undefined,
    [u, v]: [number, number],
    tolerance: number,
): LineSnap | undefined {
    let nearest: LineSnap | undefined;
    for (const entity of entities) {
        if (excludeEntityIds?.has(entity.id) || entity.type !== "line") continue;
        const lineRefs: [SketchPointRef, SketchPointRef] = [
            { entityId: entity.id, pointIndex: 0 },
            { entityId: entity.id, pointIndex: 1 },
        ];
        const [x1, y1] = solver.pointOf(lineRefs[0]);
        const [x2, y2] = solver.pointOf(lineRefs[1]);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq < 1e-12) continue;
        const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / lengthSq));
        const position: [number, number] = [x1 + t * dx, y1 + t * dy];
        const distance = Math.hypot(u - position[0], v - position[1]);
        if (distance < tolerance && (nearest === undefined || distance < nearest.distance)) {
            nearest = { lineRefs, position, distance };
        }
    }
    return nearest;
}

/** Closest datum axis within `tolerance` (the axes are infinite lines), or undefined. */
function nearestAxisSnap([u, v]: [number, number], tolerance: number): LineSnap | undefined {
    let nearest: LineSnap | undefined;
    if (Math.abs(v) < tolerance) {
        nearest = {
            lineRefs: axisLineRefs(SKETCH_X_AXIS_ID),
            position: [u, 0],
            distance: Math.abs(v),
        };
    }
    if (Math.abs(u) < tolerance && (nearest === undefined || Math.abs(u) < nearest.distance)) {
        nearest = {
            lineRefs: axisLineRefs(SKETCH_Y_AXIS_ID),
            position: [0, v],
            distance: Math.abs(u),
        };
    }
    return nearest;
}

/** Closest candidate within `tolerance` of the position, undefined when none qualifies. */
function nearestCandidate(
    candidates: SnapCandidate[],
    [u, v]: [number, number],
    tolerance: number,
): SnapCandidate | undefined {
    let nearest: SnapCandidate | undefined;
    let nearestDistance = tolerance;
    for (const candidate of candidates) {
        const distance = Math.hypot(candidate.position[0] - u, candidate.position[1] - v);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = candidate;
        }
    }
    return nearest;
}

/**
 * Snapping a point onto the spot another point of the same entity already
 * occupies would collapse it — a zero-length line, a zero-radius or zero-sweep
 * arc — so the snap is skipped.
 */
function collapsesOntoSibling(
    solver: SketchSolver,
    refs: SketchPointRef[],
    ref: SketchPointRef,
    target: [number, number],
): boolean {
    for (const other of refs) {
        if (other.pointIndex === ref.pointIndex) continue;
        const [ou, ov] = solver.pointOf(other);
        if (Math.hypot(target[0] - ou, target[1] - ov) < Precision.Distance) return true;
    }
    return false;
}

function alignToAxis(
    solver: SketchSolver,
    [p1, p2]: [SketchPointRef, SketchPointRef],
    angleToleranceDeg: number,
    added: Omit<SketchConstraintData, "id">[],
): void {
    const kinds = solver.constraintKindsOn(p1.entityId);
    if (kinds.includes(ConstraintKind.Horizontal) || kinds.includes(ConstraintKind.Vertical)) return;

    const [x1, y1] = solver.pointOf(p1);
    const [x2, y2] = solver.pointOf(p2);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < Precision.Distance) return;

    const sine = Math.sin((angleToleranceDeg * Math.PI) / 180);
    const kind =
        Math.abs(dy) <= length * sine
            ? ConstraintKind.Horizontal
            : Math.abs(dx) <= length * sine
              ? ConstraintKind.Vertical
              : undefined;
    if (kind === undefined) return;

    const constraint = { kind, refs: [p1, p2] };
    solver.addConstraint(constraint);
    added.push(constraint);
}

/**
 * Adds the tangent constraint for the partner the new entity is already
 * (near-)tangent to. The entity is read back from the solver, so the gaps are
 * measured on whatever geometry the snaps in `applyAutoConstraints` left behind.
 * That geometry is left where it is: the gap is within the tolerance by
 * construction, so the solve only closes a sub-tolerance distance, and garlic
 * reads the tangency branch (which side; internal or external) off the geometry as
 * it stands. One tangent constraint is enough for a tangent pair: the contact
 * point of a smooth curve is not a ref the sketch can address, and where it does
 * land on one — an arc endpoint touching the line, the fillet case — the point
 * snap has already pinned it there.
 */
function snapToTangency(
    solver: SketchSolver,
    entityId: number,
    tolerance: number,
    added: Omit<SketchConstraintData, "id">[],
): void {
    const entity = solver.entity(entityId);
    if (entity === undefined || tolerance <= 0) return;
    const nearest = nearestTangency(solver, entity, tolerance);
    if (nearest === undefined) return;
    const constraint = tangentConstraintFor(entity.type, entity.id, nearest.target.type, nearest.target.id);
    if (constraint === undefined) return;

    solver.addConstraint(constraint);
    added.push(constraint);
}

/**
 * The closest partner the entity is already (near-)tangent to within `tolerance`,
 * or undefined: the gap between them and the tangency kind relating them. Two
 * lines are never tangent; a tangency whose contact the user cannot see on the
 * drawn geometry does not count either — see `tangencyGap`.
 */
function nearestTangency(
    solver: SketchSolver,
    entity: SketchEntityData,
    tolerance: number,
): { kind: ConstraintKind; target: SketchEntityData; gap: number } | undefined {
    let nearest: { kind: ConstraintKind; target: SketchEntityData; gap: number } | undefined;
    for (const target of tangencyCandidates(solver, entity)) {
        const kind = tangentKindFor(entity.type, target.type);
        if (kind === undefined) continue;
        const gap = tangencyGap(entity, target, tolerance);
        if (gap === undefined || gap > tolerance) continue;
        if (nearest !== undefined && gap >= nearest.gap) continue;
        nearest = { kind, target, gap };
    }
    return nearest;
}

/**
 * Tangency partners: the constraint targets (real and external, the new entity
 * excluded) plus the two datum axes, which a circle or an arc meets tangentially
 * like any line.
 */
function tangencyCandidates(solver: SketchSolver, entity: SketchEntityData): SketchEntityData[] {
    return [
        ...constraintTargetEntities(solver).filter((x) => x.id !== entity.id),
        datumEntityData(SKETCH_X_AXIS_ID),
        datumEntityData(SKETCH_Y_AXIS_ID),
    ];
}

/**
 * How far the pair is from being tangent (sketch units) — the distance it would
 * have to close up along the constraint's direction. `undefined` when the pair
 * cannot be tangent there: two lines; a contact off the drawn geometry (a line
 * segment's span, an arc's sweep), so a tangency the user cannot see is never
 * constrained; or a degenerate one (a line through the center, concentric
 * centers), where the relation says nothing.
 */
function tangencyGap(a: SketchEntityData, b: SketchEntityData, tolerance: number): number | undefined {
    if (a.type === "line") return b.type === "line" ? undefined : lineRoundGap(a, b);
    if (b.type === "line") return lineRoundGap(b, a);
    return roundRoundGap(a, b, tolerance);
}

/** Tangency gap of a line and a circle/arc: |distance(center, line) − radius|. */
function lineRoundGap(line: SketchEntityData, round: SketchEntityData): number | undefined {
    const [x1, y1, x2, y2] = line.params;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < 1e-12) return undefined;

    const [cx, cy] = round.params;
    const t = ((cx - x1) * dx + (cy - y1) * dy) / lengthSq;
    // a drawn line is a segment, so only a contact on its span is visible; the
    // datum axes are infinite and graze on regardless of where the contact lands
    if (!isDatumEntityId(line.id) && (t < 0 || t > 1)) return undefined;
    const contact: [number, number] = [x1 + t * dx, y1 + t * dy];
    if (!contactVisible(round, contact)) return undefined;

    const centerDistance = Math.hypot(cx - contact[0], cy - contact[1]);
    // a line through the center cuts the circle instead of grazing it, and its
    // endpoint may well be pinned to that center — tangent there means nothing
    if (centerDistance < Precision.Distance) return undefined;
    return Math.abs(centerDistance - entityRadius(round));
}

/**
 * Tangency gap of two round entities: the closer of the external (centers
 * r1 + r2 apart) and the internal (r1 − r2 apart) tangency.
 */
function roundRoundGap(a: SketchEntityData, b: SketchEntityData, tolerance: number): number | undefined {
    const [ax, ay] = a.params;
    const [bx, by] = b.params;
    const centerDistance = Math.hypot(bx - ax, by - ay);
    if (centerDistance < Precision.Distance) return undefined;

    const radiusA = entityRadius(a);
    const radiusB = entityRadius(b);
    const external = Math.abs(centerDistance - (radiusA + radiusB));
    const radiusGap = Math.abs(radiusA - radiusB);
    const internal = Math.abs(centerDistance - radiusGap);
    // an internal tangency needs an annulus wider than the snap tolerance: below
    // it the centers are within coincidence range of each other, so the tangency
    // would only fight the coincidence the point snap just made
    const useInternal = radiusGap > tolerance && internal <= external;
    // the contact sits on the line through the centers, one radius from a: on the
    // far side of a's center when a encloses b, on the near side otherwise
    const sign = useInternal && radiusA < radiusB ? -1 : 1;
    const ux = ((bx - ax) / centerDistance) * sign;
    const uy = ((by - ay) / centerDistance) * sign;
    const contact: [number, number] = [ax + ux * radiusA, ay + uy * radiusA];
    if (!contactVisible(a, contact) || !contactVisible(b, contact)) return undefined;

    return useInternal ? internal : external;
}

/** Whether a contact point lying on the entity's circle is on the drawn entity. */
function contactVisible(entity: SketchEntityData, point: [number, number]): boolean {
    return entity.type !== "arc" || onArcSweep(entity.params, point);
}

/** Whether (u, v) — a point on the arc's circle — lies within its counter-clockwise sweep. */
function onArcSweep(params: number[], [u, v]: [number, number]): boolean {
    const [startAngle, sweep] = arcAngles(params);
    const offset = (Math.atan2(v - params[1], u - params[0]) - startAngle + Math.PI * 2) % (Math.PI * 2);
    return offset <= sweep;
}
