// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "@chili3d/core";
import {
    axisLineRefs,
    ConstraintKind,
    originRef,
    pointRefKey,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchConstraintData,
    type SketchEntityType,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver } from "./solver";

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
    /** Snap distance for point-on-line/axis; defaults to `pointTolerance`. */
    lineTolerance?: number;
    /** A line within this angle of an axis gets a Horizontal/Vertical constraint. */
    angleToleranceDeg?: number;
}

/**
 * Point refs of an entity that participate in snapping: line endpoints, circle
 * center, arc start/end (an arc's center is never snapped or snapped onto).
 */
function snappablePointIndices(type: SketchEntityType): number[] {
    return type === "line" ? [0, 1] : type === "arc" ? [1, 2] : [0];
}

/** Whether `ref` is already pinned to a curve by an incidence constraint. */
function hasIncidence(solver: SketchSolver, ref: SketchPointRef): boolean {
    return solver.constraintKindsOnPoint(ref).some((kind) => INCIDENCE_KINDS.includes(kind));
}

/**
 * Applies automatic constraints to a freshly created entity:
 * - endpoints/center near the origin or an existing point are snapped onto it
 *   and coincident-linked;
 * - a point not so snapped that sits near an existing line or the sketch axes
 *   is snapped onto it with a point-on-line constraint;
 * - near-horizontal / near-vertical lines get a Horizontal / Vertical constraint.
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

    snapToExistingPoints(solver, refs, options.pointTolerance, added);
    snapToExistingLines(solver, refs, options.lineTolerance ?? options.pointTolerance, added);
    if (entity.type === "line") {
        alignToAxis(
            solver,
            refs as [SketchPointRef, SketchPointRef],
            options.angleToleranceDeg ?? DEFAULT_ANGLE_TOLERANCE_DEG,
            added,
        );
    }
    return added;
}

/** A magnetic snap target for a dragged point. */
export type DragSnap =
    | { kind: "point"; point: SketchPointRef; position: [number, number] }
    | { kind: "line"; lineRefs: [SketchPointRef, SketchPointRef]; position: [number, number] };

/** Result of a magnetic snap probe: the position to resolve to, plus the target for feedback. */
export interface DragSnapResult {
    position: [number, number];
    /** The snap target, undefined when nothing snapped. */
    snap?: DragSnap;
}

/**
 * Magnetic snap probe for a point dragged to `target`: the nearest existing
 * point (coincident) or line/axis (point-on-line) within tolerance. Purely
 * positional — no constraint is added; pass `position` to `dragTo` for live
 * feedback, use `snap` to highlight the target, and call
 * `applyDragAutoConstraints` once the drag settles to make the snap stick.
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
 * Snaps an arbitrary probe position (a point being drawn) to the nearest
 * existing point/origin or line/axis. Used by the drawing commands' point step
 * for live snap feedback before the entity is committed.
 */
export function snapPosition(
    solver: SketchSolver,
    probe: [number, number],
    options: AutoConstraintOptions,
): DragSnapResult {
    let snap: DragSnap | undefined;
    if (options.pointTolerance > 0) {
        const nearest = nearestCandidate(snapCandidates(solver), probe, options.pointTolerance);
        if (nearest !== undefined) snap = { kind: "point", point: nearest.ref, position: nearest.position };
    }

    const lineTolerance = options.lineTolerance ?? options.pointTolerance;
    if (snap === undefined && lineTolerance > 0) {
        const nearest = nearestLineOrAxisSnap(solver, undefined, probe, lineTolerance);
        if (nearest !== undefined)
            snap = { kind: "line", lineRefs: nearest.lineRefs, position: nearest.position };
    }
    return snap === undefined ? { position: probe } : { position: snap.position, snap };
}

/**
 * Settles a just-finished drag: if the point is still near an existing point
 * or line/axis, adds the matching coincident / point-on-line constraint and
 * snaps the point onto it. Returns the added constraints. Call `solve` afterwards.
 */
export function applyDragAutoConstraints(
    solver: SketchSolver,
    ref: SketchPointRef,
    options: AutoConstraintOptions,
): Omit<SketchConstraintData, "id">[] {
    return applyPointAutoConstraints(solver, [ref], [ref.entityId], options);
}

/**
 * Applies automatic coincident / point-on-line constraints to freshly created
 * points that belong to a shape built from several entities at once (the
 * rectangle's two diagonal corners). `excludeEntityIds` lists the shape's own
 * entities so its corners never snap onto each other's edges. Returns the
 * added constraints. Call `solve` afterwards.
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

        let constraint: Omit<SketchConstraintData, "id">;
        if (snap.kind === "line") {
            constraint = { kind: ConstraintKind.PointOnLine, refs: [ref, ...snap.lineRefs] };
        } else {
            // a point already coincident with the datum origin is re-snapped harmlessly
            if (solver.hasConstraint(ConstraintKind.P2PCoincident, [ref, snap.point])) continue;
            constraint = { kind: ConstraintKind.P2PCoincident, refs: [ref, snap.point] };
        }

        solver.setPointPosition(ref, snap.position[0], snap.position[1]);
        solver.addConstraint(constraint);
        added.push(constraint);
    }
    return added;
}

/** Nearest coincident / point-on-line snap for a dragged point, or undefined. */
function findDragSnap(
    solver: SketchSolver,
    ref: SketchPointRef,
    probe: [number, number],
    options: AutoConstraintOptions,
): DragSnap | undefined {
    return findPointSnap(solver, ref, probe, new Set([ref.entityId]), options);
}

/** Nearest coincident / point-on-line snap for a point, excluding `excludeEntityIds`, or undefined. */
function findPointSnap(
    solver: SketchSolver,
    ref: SketchPointRef,
    probe: [number, number],
    excludeEntityIds: ReadonlySet<number> | undefined,
    options: AutoConstraintOptions,
): DragSnap | undefined {
    if (options.pointTolerance > 0) {
        const snap = nearestPointSnap(solver, ref, probe, excludeEntityIds, options.pointTolerance);
        if (snap !== undefined) return { kind: "point", point: snap.ref, position: snap.position };
    }

    const lineTolerance = options.lineTolerance ?? options.pointTolerance;
    if (lineTolerance > 0 && !hasIncidence(solver, ref)) {
        const snap = nearestLineOrAxisSnap(solver, excludeEntityIds, probe, lineTolerance);
        if (snap !== undefined) return { kind: "line", lineRefs: snap.lineRefs, position: snap.position };
    }
    return undefined;
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
    const candidates = snapCandidates(solver, refs[0].entityId);

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
    for (const ref of refs) {
        // a point snap (or an existing incidence) already anchors this point
        if (
            solver.constraintKindsOnPoint(ref).includes(ConstraintKind.P2PCoincident) ||
            hasIncidence(solver, ref)
        ) {
            continue;
        }
        const snap = nearestLineOrAxisSnap(solver, new Set([ref.entityId]), solver.pointOf(ref), tolerance);
        if (snap === undefined) continue;

        solver.setPointPosition(ref, snap.position[0], snap.position[1]);
        const constraint = { kind: ConstraintKind.PointOnLine, refs: [ref, ...snap.lineRefs] };
        solver.addConstraint(constraint);
        added.push(constraint);
    }
}

/** Snap targets: every snappable point of the other entities, plus the origin (last, so a real point wins ties). */
function snapCandidates(solver: SketchSolver, excludeEntityId?: number): SnapCandidate[] {
    const candidates: SnapCandidate[] = solver
        .entities()
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

/** Snap targets for a dragged point: other entities' points plus the origin, minus excluded entities and the coincident group. */
function nearestPointSnap(
    solver: SketchSolver,
    ref: SketchPointRef,
    target: [number, number],
    excludeEntityIds: ReadonlySet<number> | undefined,
    tolerance: number,
): SnapCandidate | undefined {
    const excluded = new Set(solver.coincidentGroup(ref).map(pointRefKey));
    excluded.add(pointRefKey(ref));

    const candidates: SnapCandidate[] = [];
    for (const entity of solver.entities()) {
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
    excludeEntityIds: ReadonlySet<number> | undefined,
    probe: [number, number],
    tolerance: number,
): LineSnap | undefined {
    const line = nearestLineSnap(solver, excludeEntityIds, probe, tolerance);
    const axis = nearestAxisSnap(probe, tolerance);
    if (axis === undefined) return line;
    if (line === undefined) return axis;
    return line.distance <= axis.distance ? line : axis;
}

/** Closest line whose segment passes within `tolerance` of the probe, or undefined. */
function nearestLineSnap(
    solver: SketchSolver,
    excludeEntityIds: ReadonlySet<number> | undefined,
    [u, v]: [number, number],
    tolerance: number,
): LineSnap | undefined {
    let nearest: LineSnap | undefined;
    for (const entity of solver.entities()) {
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

/** Snapping an endpoint onto its sibling endpoint's spot would collapse the line/arc to a point. */
function collapsesOntoSibling(
    solver: SketchSolver,
    refs: SketchPointRef[],
    ref: SketchPointRef,
    target: [number, number],
): boolean {
    if (refs.length !== 2) return false;
    const other = refs.find((r) => r.pointIndex !== ref.pointIndex)!;
    const [ou, ov] = solver.pointOf(other);
    return Math.hypot(target[0] - ou, target[1] - ov) < Precision.Distance;
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
