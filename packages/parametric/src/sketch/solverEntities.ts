// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "@chili3d/core";
import { ConstraintKind, isExternalEntityId, type SketchEntityData } from "./sketchModel";
import type { SketchSolver } from "./solver";

/**
 * Every entity a constraint or snap can target: the real sketch entities plus
 * the seeded external references. Externals are pinned (never draggable or
 * deletable), so a constraint snapped onto one is always satisfiable from the
 * sketch side.
 */
export function constraintTargetEntities(solver: SketchSolver): SketchEntityData[] {
    return [...solver.entities(), ...solver.externalEntitiesData()];
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
];

export function isAssociativeConstraintKind(kind: ConstraintKind): boolean {
    return ASSOCIATIVE_KINDS.includes(kind);
}

/**
 * Whether `kind` may target the picked entity: an external entity accepts only
 * associative kinds. A rejected pick pubs a status-bar tip and returns false.
 */
export function allowsConstraintOnEntity(kind: ConstraintKind, entityId: number): boolean {
    if (!isExternalEntityId(entityId) || isAssociativeConstraintKind(kind)) return true;
    PubSub.default.pub("statusBarTip", "sketch.externalRefAssociativeOnly");
    return false;
}
