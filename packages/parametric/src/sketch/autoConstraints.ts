// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision } from "@chili3d/core";
import { ConstraintKind, type SketchConstraintData, type SketchPointRef } from "./sketchModel";
import type { SketchSolver } from "./solver";

const DEFAULT_ANGLE_TOLERANCE_DEG = 5;

export interface AutoConstraintOptions {
    /** Snap distance (sketch-plane units) for endpoint-on-endpoint coincidence. */
    pointTolerance: number;
    /** A line within this angle of an axis gets a Horizontal/Vertical constraint. */
    angleToleranceDeg?: number;
}

/**
 * Applies automatic constraints to a freshly created entity:
 * - endpoints/center near an existing point are snapped onto it and coincident-linked;
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

    const refs: SketchPointRef[] =
        entity.type === "line"
            ? [
                  { entityId, pointIndex: 0 },
                  { entityId, pointIndex: 1 },
              ]
            : [{ entityId, pointIndex: 0 }];

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

function snapToExistingPoints(
    solver: SketchSolver,
    refs: SketchPointRef[],
    tolerance: number,
    added: Omit<SketchConstraintData, "id">[],
): void {
    if (tolerance <= 0) return;
    const candidates = solver
        .entities()
        .filter((e) => e.id !== refs[0].entityId)
        .flatMap((e) =>
            (e.type === "line" ? [0, 1] : [0]).map((pointIndex) => ({
                ref: { entityId: e.id, pointIndex },
                position: solver.pointOf({ entityId: e.id, pointIndex }),
            })),
        );
    if (candidates.length === 0) return;

    for (const ref of refs) {
        const [u, v] = solver.pointOf(ref);
        let nearest: (typeof candidates)[number] | undefined;
        let nearestDistance = tolerance;
        for (const candidate of candidates) {
            const distance = Math.hypot(candidate.position[0] - u, candidate.position[1] - v);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = candidate;
            }
        }
        if (nearest === undefined) continue;

        // never collapse a line onto a single point
        if (refs.length === 2) {
            const other = refs.find((r) => r.pointIndex !== ref.pointIndex)!;
            const [ou, ov] = solver.pointOf(other);
            if (Math.hypot(nearest.position[0] - ou, nearest.position[1] - ov) < Precision.Distance) {
                continue;
            }
        }

        solver.setPointPosition(ref, nearest.position[0], nearest.position[1]);
        const constraint = { kind: ConstraintKind.P2PCoincident, refs: [ref, nearest.ref] };
        solver.addConstraint(constraint);
        added.push(constraint);
    }
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
