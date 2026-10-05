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

/** Keyed by the sorted type pair (`[type1, type2].sort().join("+")`). */
const TANGENT_KINDS = new Map<string, ConstraintKind>([
    ["circle+line", ConstraintKind.TangentLineCircle],
    ["arc+line", ConstraintKind.TangentLineArc],
    ["circle+circle", ConstraintKind.TangentCircleCircle],
    ["arc+arc", ConstraintKind.TangentArcArc],
    ["arc+circle", ConstraintKind.TangentCircleArc],
]);

/** The tangency kind relating two entity types, or `undefined` for a pair that is never tangent: two lines. */
export function tangentKindFor(
    type1: SketchEntityType | undefined,
    type2: SketchEntityType | undefined,
): ConstraintKind | undefined {
    return TANGENT_KINDS.get([type1, type2].sort().join("+"));
}

/**
 * The tangent constraint relating two entities, refs in the garlic params layout
 * (line endpoints first, then a circle's center, then an arc's center and start).
 * Argument order is irrelevant; `undefined` for a pair that cannot be tangent:
 * two lines.
 */
export function tangentConstraintFor(
    type1: SketchEntityType | undefined,
    entityId1: number,
    type2: SketchEntityType | undefined,
    entityId2: number,
): { kind: ConstraintKind; refs: SketchPointRef[] } | undefined {
    switch (tangentKindFor(type1, type2)) {
        case ConstraintKind.TangentLineCircle: {
            // the line leads the params layout, whichever way round the pair came in
            const [line, circle] = type1 === "line" ? [entityId1, entityId2] : [entityId2, entityId1];
            return { kind: ConstraintKind.TangentLineCircle, refs: [...lineRefs(line), centerRef(circle)] };
        }
        case ConstraintKind.TangentLineArc: {
            const [line, arc] = type1 === "line" ? [entityId1, entityId2] : [entityId2, entityId1];
            return {
                kind: ConstraintKind.TangentLineArc,
                refs: [...lineRefs(line), centerRef(arc), arcStartRef(arc)],
            };
        }
        case ConstraintKind.TangentCircleCircle:
            return {
                kind: ConstraintKind.TangentCircleCircle,
                refs: [centerRef(entityId1), centerRef(entityId2)],
            };
        case ConstraintKind.TangentArcArc:
            return {
                kind: ConstraintKind.TangentArcArc,
                refs: [
                    centerRef(entityId1),
                    arcStartRef(entityId1),
                    centerRef(entityId2),
                    arcStartRef(entityId2),
                ],
            };
        case ConstraintKind.TangentCircleArc: {
            // the circle leads the params layout here too
            const [circle, arc] = type1 === "circle" ? [entityId1, entityId2] : [entityId2, entityId1];
            return {
                kind: ConstraintKind.TangentCircleArc,
                refs: [centerRef(circle), centerRef(arc), arcStartRef(arc)],
            };
        }
        default:
            return undefined;
    }
}
