// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ellipseParameterOf,
    ellipseSweep,
    entityArcLength,
    intersectCurves,
    isClosedCurveType,
    lengthAtPoint,
    pointAtSupportLength,
    projectPoint,
    projectSupport,
    sampleSupportPiece,
    supportLengthAt,
} from "./curveEval";
import {
    arcAngles,
    datumEntityData,
    entityPointCount,
    isDatumEntityId,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchEntityData,
    type SketchPointRef,
} from "./sketchModel";
import type { SketchSolver } from "./solver";

/**
 * The 2D geometry every curve edit in the sketch is built on: where a point sits along an
 * entity, where two curves cross, and which curves can cross the one being edited. It is
 * read-only — it takes a solver to enumerate the sketch's geometry and never writes to it —
 * so `trimOps`, `extendOps` and `breakOps` can share it without sharing each other.
 *
 * Two levels of crossing matter and both are here. `rawIntersections` answers where two
 * *support curves* meet, reading a line as the infinite line it is drawn as and a circle as
 * the whole circle: that is what a trim's cutters are found with, and what an extension
 * runs out to. `intersectWithin` adds the extent test on top, for a crossing that has to
 * fall on the geometry the user can actually see.
 *
 * The line, circle and arc keep their analytic answers (exact, and fast enough to run per
 * hover); the free curves and the ellipse read through `curveEval`'s numerics —
 * sampled projections, Newton-refined crossings — so a mixed pair of curves crosses in one
 * code path.
 */

/** One crossing of an entity with another entity, as a position along the first. */
export interface CurveCrossing {
    /** Sketch (u, v) of the crossing. */
    point: [number, number];
    /** Distance from the entity's origin along the entity — see `parameterAt`. */
    s: number;
    /** What crosses here: the new endpoint is pinned onto it. */
    cutter: SketchEntityData;
}

/**
 * A piece of a sketch entity, in the shapes a curve is drawn in. The ops hand this to
 * the editor, which knows how to mesh it; keeping the piece in sketch terms is what lets a
 * preview and the op it previews agree on it without either knowing about meshes. The
 * numeric families (ellipse, conic, bezier, nurbs) answer in the one shape they have: a sampled
 * polyline — `sampleSupportPiece`'s, so a piece running past an end draws too.
 */
export type CurvePiece =
    | { readonly kind: "line"; readonly point1: [number, number]; readonly point2: [number, number] }
    | {
          readonly kind: "arc";
          readonly center: [number, number];
          readonly radius: number;
          /** Radians, counter-clockwise, from `startAngle`. */
          readonly startAngle: number;
          readonly sweep: number;
      }
    | { readonly kind: "polyline"; readonly points: readonly [number, number][] };

/** The two end point indices of an open entity; `undefined` for a closed one, which has none. */
export function entityEndIndices(
    entity: Pick<SketchEntityData, "type" | "params">,
): [number, number] | undefined {
    switch (entity.type) {
        case "line":
            return [0, 1];
        case "arc":
            return [1, 2];
        case "ellipseArc":
            return [3, 4];
        case "conic":
            return [0, 2];
        case "bezier":
            return [0, 3];
        case "nurbs":
            // clamped at both ends, so the first and last control point are on the curve —
            // which is what makes them its ends
            return [0, entityPointCount(entity) - 1];
        default:
            return undefined;
    }
}

/** The point ref the entity's origin end sits at: a line's start, an arc's start. */
export function originEnd(entity: SketchEntityData): SketchPointRef {
    return { entityId: entity.id, pointIndex: entityEndIndices(entity)?.[0] ?? 0 };
}

/** The point ref at the other end: a line's end, an arc's end. */
export function farEnd(entity: SketchEntityData): SketchPointRef {
    return { entityId: entity.id, pointIndex: entityEndIndices(entity)?.[1] ?? 0 };
}

// ------------------------------------------------------------------ Positions along an entity

/**
 * Length `s` runs over: a line's length, an arc's swept length, a circle's
 * circumference. The numeric families measure their drawn curve by sampling
 * (`curveEval.entityArcLength`).
 */
export function entityLength(entity: SketchEntityData): number {
    if (entity.type === "line") {
        return Math.hypot(entity.params[2] - entity.params[0], entity.params[3] - entity.params[1]);
    }
    if (entity.type === "circle" || entity.type === "arc") {
        const radius = entityRadiusOf(entity);
        return entity.type === "circle" ? Math.PI * 2 * radius : arcAngles(entity.params)[1] * radius;
    }
    return entityArcLength(entity);
}

/**
 * Where `point` sits along the entity, as a distance from its origin — a line's start
 * point, an arc's start point, a circle's zero angle. One scalar for all seven types, so
 * the piece between two cuts is an interval and "shorter than the tolerance" means
 * the same thing everywhere. The numeric families read the arclength of the point's
 * projection, which is the same reading on the drawn curve.
 */
export function parameterAt(entity: SketchEntityData, point: [number, number]): number {
    if (entity.type === "line") {
        const [x1, y1, x2, y2] = entity.params;
        const length = entityLength(entity);
        if (length < 1e-12) return 0;
        return ((point[0] - x1) * (x2 - x1) + (point[1] - y1) * (y2 - y1)) / length;
    }
    if (entity.type === "circle" || entity.type === "arc") {
        const [cx, cy] = entity.params;
        const from = originAngle(entity);
        const angle = Math.atan2(point[1] - cy, point[0] - cx);
        return normalizeAngle(angle - from) * entityRadiusOf(entity);
    }
    return lengthAtPoint(entity, point);
}

/**
 * Where `point` sits along the entity's *support* curve, as a signed distance from its
 * origin: past the far end reads beyond `entityLength`, past the origin end negative
 * (an arc's and an ellipseArc's wrap is the caller's to undo — `extendOps.endParameter`).
 * That is the reading an extend needs: its corner lies off the drawn curve by definition.
 */
export function supportParameterAt(entity: SketchEntityData, point: [number, number]): number {
    if (
        entity.type === "line" ||
        entity.type === "circle" ||
        entity.type === "arc" ||
        entity.type === "ellipse"
    ) {
        return parameterAt(entity, point);
    }
    if (entity.type === "ellipseArc") {
        // the angle on the whole ellipse, folded into the sweep's own turn, then measured
        const [start] = ellipseSweep(entity.params);
        const t = start + normalizeAngle(ellipseParameterOf(entity.params, point) - start);
        return supportLengthAt(entity, t);
    }
    return supportLengthAt(entity, projectSupport(entity, point).t);
}

/** The circle an entity lies on: a circle's own, an arc's from centre to start. */
export function entityRadiusOf(entity: SketchEntityData): number {
    if (entity.type === "circle") return entity.params[2];
    return Math.hypot(entity.params[2] - entity.params[0], entity.params[3] - entity.params[1]);
}

/** The sketch (u, v) one distance `s` along the entity, from the same origin `parameterAt` measures. */
export function pointAt(entity: SketchEntityData, s: number): [number, number] {
    if (entity.type === "line") {
        const [x1, y1, x2, y2] = entity.params;
        const length = entityLength(entity);
        const t = length < 1e-12 ? 0 : s / length;
        return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    if (entity.type === "circle" || entity.type === "arc") {
        const [cx, cy] = entity.params;
        const radius = entityRadiusOf(entity);
        const angle = originAngle(entity) + s / radius;
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    }
    return pointAtSupportLength(entity, s);
}

/** Where `s` counts from: a circle's zero angle, an arc's start ray. */
export function originAngle(entity: SketchEntityData): number {
    return entity.type === "circle" ? 0 : arcAngles(entity.params)[0];
}

/**
 * The piece of an entity between two positions along it, in the terms the editor draws
 * entities in — a straight segment for a line, an arc of the entity's own circle, a
 * sampled polyline for the numeric families. `start` and `arcLength` are the arclength
 * `parameterAt` speaks, so the angle falls out of the radius without either caller going
 * near one. A negative `arcLength` sweeps backwards, which is how a piece before the
 * origin end is drawn; on the numeric families the sampling runs on the support curve,
 * so a piece past an end (an extend's gain) draws too.
 */
export function pieceGeometry(entity: SketchEntityData, start: number, arcLength: number): CurvePiece {
    if (entity.type === "line") {
        return { kind: "line", point1: pointAt(entity, start), point2: pointAt(entity, start + arcLength) };
    }
    if (entity.type !== "circle" && entity.type !== "arc") {
        return { kind: "polyline", points: sampleSupportPiece(entity, start, start + arcLength) };
    }
    const radius = entityRadiusOf(entity);
    return {
        kind: "arc",
        center: [entity.params[0], entity.params[1]],
        radius,
        startAngle: originAngle(entity) + start / radius,
        sweep: arcLength / radius,
    };
}

/** An angle folded into [0, 2π). */
export function normalizeAngle(angle: number): number {
    const full = Math.PI * 2;
    return ((angle % full) + full) % full;
}

// ------------------------------------------------------------------ Crossings

/** Every crossing of `entity` with the sketch's other geometry, in order along it. */
export function cutsOn(solver: SketchSolver, entity: SketchEntityData, tolerance: number): CurveCrossing[] {
    const cuts: CurveCrossing[] = [];
    for (const cutter of cuttersFor(solver, entity)) {
        for (const point of intersectWithin(entity, cutter, tolerance)) {
            cuts.push({ point, s: parameterAt(entity, point), cutter });
        }
    }
    return collapseCuts(entity, cuts, tolerance);
}

/**
 * What can cut the entity: every other entity, the external references, and the datum
 * axes. The axes are read as the infinite lines the editor draws them as, so a line
 * crossing the X axis beyond the unit segment the datum is stored with is still cut
 * there.
 */
export function cuttersFor(solver: SketchSolver, entity: SketchEntityData): SketchEntityData[] {
    return [
        ...solver.entities().filter((other) => other.id !== entity.id && !isDegenerate(other)),
        ...solver.externalEntitiesData().filter((other) => !isDegenerate(other)),
        datumEntityData(SKETCH_X_AXIS_ID),
        datumEntityData(SKETCH_Y_AXIS_ID),
    ];
}

/** An entity with no extent defines no crossing: a zero-length line, a point arc. */
export function isDegenerate(entity: SketchEntityData): boolean {
    return entityLength(entity) < 1e-9;
}

/**
 * The cuts in order along the entity, coincident ones merged: two cutters meeting an
 * entity at the same point bound one piece, not two, and a tangency's double root is
 * one crossing. The first of a merged group keeps its cutter, which is the one the
 * new endpoint is pinned to.
 */
export function collapseCuts(
    entity: SketchEntityData,
    cuts: CurveCrossing[],
    tolerance: number,
): CurveCrossing[] {
    const merged: CurveCrossing[] = [];
    for (const cut of [...cuts].sort((a, b) => a.s - b.s)) {
        const previous = merged.at(-1);
        if (previous !== undefined && cut.s - previous.s <= tolerance) continue;
        merged.push(cut);
    }
    // a closed curve's first and last cut can be one crossing either side of the seam
    if (isClosedCurveType(entity.type) && merged.length > 1) {
        const seam = merged[0].s + entityLength(entity) - merged[merged.length - 1].s;
        if (seam <= tolerance) merged.pop();
    }
    return merged;
}

/**
 * Every crossing of two entities' *support curves*, as sketch (u, v) points: a line reads
 * as its infinite line and a circle as the whole circle, so a crossing reaches beyond the
 * geometry the user can see. That is what an extension runs out to, and what a trim's
 * cutters are enumerated with before `intersectWithin` puts the extent test back on.
 *
 * Two line/circle/arc pairs keep their exact analytic answers; anything touching the
 * numeric families goes through `intersectCurves`' sampled-and-refined search, whose
 * support domains carry the same reading (an ellipseArc's whole ellipse, a bezier's
 * clamped extrapolation).
 */
export function rawIntersections(a: SketchEntityData, b: SketchEntityData): [number, number][] {
    const analytic = (type: SketchEntityData["type"]) =>
        type === "line" || type === "circle" || type === "arc";
    if (!analytic(a.type) || !analytic(b.type)) {
        return intersectCurves(a, b, true).map((crossing) => crossing.point);
    }
    return a.type === "line" && b.type === "line"
        ? intersectLineLine(lineOf(a), lineOf(b))
        : a.type === "line"
          ? intersectLineCircle(lineOf(a), circleOf(b))
          : b.type === "line"
            ? intersectLineCircle(lineOf(b), circleOf(a))
            : intersectCircleCircle(circleOf(a), circleOf(b));
}

/** Every crossing of two entities, as sketch (u, v) points, neither further off than `tolerance`. */
export function intersectWithin(
    a: SketchEntityData,
    b: SketchEntityData,
    tolerance: number,
): [number, number][] {
    return rawIntersections(a, b).filter(
        (point) => onEntity(a, point, tolerance) && onEntity(b, point, tolerance),
    );
}

export interface LineGeometry {
    origin: [number, number];
    direction: [number, number];
}

export interface CircleGeometry {
    center: [number, number];
    radius: number;
}

export function lineOf(entity: SketchEntityData): LineGeometry {
    const [x1, y1, x2, y2] = entity.params;
    return { origin: [x1, y1], direction: [x2 - x1, y2 - y1] };
}

export function circleOf(entity: SketchEntityData): CircleGeometry {
    return { center: [entity.params[0], entity.params[1]], radius: entityRadiusOf(entity) };
}

/** Whether `point` lies on the entity, no further than `tolerance` off it. */
export function onEntity(entity: SketchEntityData, point: [number, number], tolerance: number): boolean {
    // a datum axis is the infinite line it is drawn as
    if (isDatumEntityId(entity.id)) return true;
    if (entity.type === "line") return pointToSegmentDistance(point, lineOf(entity)) <= tolerance;
    if (entity.type !== "circle" && entity.type !== "arc") {
        // a numeric family's projection is clamped to the drawn domain, so the extent
        // test is the distance test
        return projectPoint(entity, point).distance <= tolerance;
    }
    const { center, radius } = circleOf(entity);
    const off = Math.hypot(point[0] - center[0], point[1] - center[1]);
    if (Math.abs(off - radius) > tolerance) return false;
    if (entity.type === "circle") return true;
    // on an arc the crossing must also fall inside its sweep — the same tolerance,
    // taken as an angle at that radius
    const [start, sweep] = arcAngles(entity.params);
    const offset = normalizeAngle(Math.atan2(point[1] - center[1], point[0] - center[0]) - start);
    return offset <= sweep + tolerance / radius || Math.PI * 2 - offset <= tolerance / radius;
}

export function pointToSegmentDistance(point: [number, number], line: LineGeometry): number {
    const [dx, dy] = line.direction;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-18) {
        return Math.hypot(point[0] - line.origin[0], point[1] - line.origin[1]);
    }
    const t = Math.max(
        0,
        Math.min(1, ((point[0] - line.origin[0]) * dx + (point[1] - line.origin[1]) * dy) / lengthSquared),
    );
    return Math.hypot(point[0] - (line.origin[0] + t * dx), point[1] - (line.origin[1] + t * dy));
}

/**
 * The two infinite lines' crossing. Parallel lines have none — and neither do
 * collinear ones, deliberately: a cutter lying along the entity bounds no piece of
 * it, so it must not read as a run of crossings along its whole length.
 */
export function intersectLineLine(a: LineGeometry, b: LineGeometry): [number, number][] {
    const [ax, ay] = a.direction;
    const [bx, by] = b.direction;
    const det = ax * by - ay * bx;
    if (Math.abs(det) <= 1e-9 * Math.hypot(ax, ay) * Math.hypot(bx, by)) return [];
    const dx = b.origin[0] - a.origin[0];
    const dy = b.origin[1] - a.origin[1];
    const t = (dx * by - dy * bx) / det;
    return [[a.origin[0] + t * ax, a.origin[1] + t * ay]];
}

/** The line's crossing with the circle: two points, one when the line is tangent. */
export function intersectLineCircle(line: LineGeometry, circle: CircleGeometry): [number, number][] {
    const [dx, dy] = line.direction;
    const fx = line.origin[0] - circle.center[0];
    const fy = line.origin[1] - circle.center[1];
    const a = dx * dx + dy * dy;
    if (a < 1e-18) return [];
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - circle.radius * circle.radius;
    const discriminant = b * b - 4 * a * c;
    const epsilon = 1e-9 * (b * b + Math.abs(4 * a * c));
    if (discriminant < -epsilon) return [];
    // a tangent's double root is one crossing, and must not read as two cuts
    const roots =
        Math.abs(discriminant) <= epsilon
            ? [-b / (2 * a)]
            : [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)];
    return roots.map((t) => [line.origin[0] + t * dx, line.origin[1] + t * dy]);
}

/** The two circles' crossings, taken on the radical line; none when concentric or apart. */
export function intersectCircleCircle(a: CircleGeometry, b: CircleGeometry): [number, number][] {
    const dx = b.center[0] - a.center[0];
    const dy = b.center[1] - a.center[1];
    const distance = Math.hypot(dx, dy);
    const epsilon = 1e-9 * Math.max(a.radius, b.radius, distance);
    if (distance <= epsilon) return [];
    if (distance > a.radius + b.radius + epsilon) return [];
    if (distance < Math.abs(a.radius - b.radius) - epsilon) return [];
    const along = (a.radius * a.radius - b.radius * b.radius + distance * distance) / (2 * distance);
    const halfSquared = a.radius * a.radius - along * along;
    const ux = dx / distance;
    const uy = dy / distance;
    const foot: [number, number] = [a.center[0] + along * ux, a.center[1] + along * uy];
    if (halfSquared <= epsilon * epsilon) return [foot];
    const offset = Math.sqrt(halfSquared);
    return [
        [foot[0] - offset * uy, foot[1] + offset * ux],
        [foot[0] + offset * uy, foot[1] - offset * ux],
    ];
}
