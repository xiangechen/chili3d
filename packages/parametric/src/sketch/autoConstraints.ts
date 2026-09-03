// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "@chili3d/core";
import {
    ConstraintKind,
    originRef,
    type SketchConstraintData,
    type SketchEntityType,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver } from "./solver";

const DEFAULT_ANGLE_TOLERANCE_DEG = 5;

export interface AutoConstraintOptions {
    /** Snap distance (sketch-plane units) for endpoint-on-endpoint coincidence. */
    pointTolerance: number;
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

/**
 * Applies automatic constraints to a freshly created entity:
 * - endpoints/center near the origin or an existing point are snapped onto it
 *   and coincident-linked;
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

/** Snap targets: every snappable point of the other entities, plus the origin (last, so a real point wins ties). */
function snapCandidates(solver: SketchSolver, excludeEntityId: number): SnapCandidate[] {
    const candidates: SnapCandidate[] = solver
        .entities()
        .filter((e) => e.id !== excludeEntityId)
        .flatMap((e) =>
            snappablePointIndices(e.type).map((pointIndex) => {
                const ref = { entityId: e.id, pointIndex };
                return { ref, position: solver.pointOf(ref) };
            }),
        );
    candidates.push({ ref: originRef(), position: [0, 0] });
    return candidates;
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
