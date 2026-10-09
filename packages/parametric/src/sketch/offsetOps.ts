// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, pointLineSignedDistance, Result } from "@chili3d/core";
import {
    type CurveEntity,
    entityDomain,
    entityPeriod,
    entityTangentAt,
    evaluateEntity,
    intersectCurves,
    isClosedCurveType,
    offsetSideSign,
    projectPoint,
    projectSupport,
    segmentCrossing,
} from "./curveEval";
import { entityEndIndices } from "./curveGeometry";
import { pointLineReading } from "./editor/dimensionLayout";
import {
    ConstraintKind,
    entityRadius,
    type NurbsSpec,
    type OffsetCurveRef,
    pointRefKey,
    type SketchEntityData,
    type SketchEntityType,
    type SketchPointRef,
    sameEntityGeometry,
} from "./sketchModel";
import type { SketchSolver } from "./solver";
import { centerRef, lineRefs } from "./solverEntities";

/**
 * The sketch offset: a *tied* copy of the selected entities, shifted a distance to one
 * side. The side is the caller's sign — the entities of one chain are traversed as a
 * chain, so "left of the traversal" is one side for all of them, and a closed loop comes
 * out consistently inside or outside rather than a mix of the two. What "left" means on
 * one entity is per kind, and deliberate: see `offsetParams`.
 *
 * The copy is held by the source rather than copied, the same choice the mirror makes
 * (see `mirrorOps.ts`): each line copy is `Parallel` to its source at a fixed
 * `P2LDistance`, and because that distance carries a datum it *is* a dimension on the
 * sketch — editable like any other, so the tool is one drag to place and one number to
 * adjust afterwards. Adjacent copies are stitched at the corners with `P2PCoincident`,
 * which is what makes a closed loop exactly rigid: N lines have 4N degrees of freedom,
 * and N parallels + N distances + N coincidences (two equations each) take exactly 4N.
 * That is also FreeCAD's own count (its Intersection mode is criticised for adding about
 * twice as much — FreeCAD/FreeCAD#32699 — so nothing here is decorative).
 *
 * Corners are joined by intersecting the offset **carriers** — the infinite line, the
 * whole circle — never the trimmed curves, and the solution nearest the original corner
 * is the one taken. It matters for arcs: their start point *is* their radius, so moving
 * one onto a point that is not on the offset circle would resize the arc. Both Fusion
 * and FreeCAD document the same join: extend/trim the neighbours to their intersection,
 * so a rectangle offsets to a rectangle instead of four crossing lines.
 *
 * Two things the solver cannot express, and the tool therefore does not pretend to. A
 * circle's or an arc's offset radius is a *difference* of radii, and garlic has no such
 * constraint (`EqualRadius`/`EqualArcRadius` only state equality, and tangency between
 * concentric curves degenerates to equality) — so a circle or arc copy is held
 * concentric by its centre alone and keeps the radius it was created with. Neither is a
 * branched pick (three edges meeting at one point) joined: which pair would meet there
 * is ambiguous, so those edges offset independently and the caller says so.
 *
 * The five numeric families — the ellipse, the ellipseArc, the conic, the cubic bezier and
 * the NURBS — are offset differently, and the reason is mathematics rather than taste: **the
 * offset of a curve is not a curve of its own kind**. An ellipse's parallel curve is not an
 * ellipse, a cubic's is not a cubic, and garlic has no constraint expressing "this curve is
 * that one offset by d" to hold a copy of the same kind in place (`P2PDistance` is between
 * points, `P2LDistance` between a point and a line). Onshape solves the same problem by
 * keeping the copy as its source's parameters *plus* an offset value and evaluating it
 * numerically, held by one of its minimum-distance constraints; garlic has no such
 * constraint, and its build is not in this repository — so there is nothing for a tied copy
 * to be tied *by*.
 *
 * Those copies are therefore plain, unattached geometry — no constraint ties them to their
 * source, and `offsetCurve` is the kind that holds them (see `offsetCurveGeometry`): the
 * source's own params, the distance, and nothing else. The parallel curve is what the
 * evaluator reads off that pair (`curveEval.offsetAdapter`), so a copy *does* follow its
 * source — exactly, and with no fitted control points for the user to look at — but nothing
 * holds its two ends anywhere, and the number that is its distance is the only handle it has.
 *
 * The op mirrors `cornerOps.ts` / `trimOps.ts`: pure geometry plus direct solver
 * mutation, all of it rolled back on any failure, with the caller solving and committing
 * afterwards.
 */

/** A point of a copy — its id only exists once the copy has been created. */
interface CopyPoint {
    readonly copyIndex: number;
    readonly pointIndex: number;
}

/** One copy worked out ahead of the solver mutation: the source, and the final geometry. */
interface OffsetCopy {
    readonly source: SketchEntityData;
    /** Read off the solver: `entity()` does not carry the flag, `entities()` does. */
    readonly construction: boolean;
    /**
     * The copy's own kind: the source's for the families garlic can tie — a line, a circle, an
     * arc — and `offsetCurve` for the five whose parallel curve is not a curve of their own kind.
     */
    readonly type: SketchEntityType;
    params: number[];
    /** An `offsetCurve` copy's source and distance; its construction constants are the source's. */
    readonly offset?: OffsetCurveRef;
    /** An `offsetCurve` copy of a NURBS source carries the source's spec, its params need it. */
    readonly nurbs?: NurbsSpec;
}

/** The geometry a copy gets: its kind, its params, and the spec a `nurbs` source is read with. */
interface OffsetGeometry {
    readonly type: SketchEntityType;
    readonly params: number[];
    readonly nurbs?: NurbsSpec;
    readonly offset?: OffsetCurveRef;
}

/**
 * A line copy's ties. `Parallel` and the distance hold the copy on its source's left at
 * the offset distance, but leave its two ends free to slide along that line — so every
 * end no corner pins is tied to the source's own end instead: the segment from the
 * source's end to the copy's is `Perpendicular` to the source, which is what makes it
 * the offset vector rather than a slide. With the copy's carrier already the offset
 * line, that perpendicular meets it in exactly one point.
 *
 * Perpendicular rather than a distance between the two ends: the two would be *tangent*
 * there (the end of a perpendicular offset is the foot), and garlic's Jacobian is
 * singular at a tangency — the solve then stalls or reports a conflict depending on
 * where it started. The perpendicular states the same thing with no degeneracy, and
 * without a datum, so a free end costs no extra dimension label.
 *
 * The ends a corner *did* pin take no such tie: the join moved them to the corner's
 * intersection, which is generally not the source end's perpendicular foot (an open
 * chain's first segment is trimmed by the join, not translated).
 */
interface LineTies {
    readonly copyIndex: number;
    readonly source: SketchEntityData;
    /** Point indices of the copy's ends that no corner pins. */
    readonly freePoints: readonly number[];
}

/** A joint between two picked entities: the endpoints that meet, and where. */
interface SourceJoint {
    readonly refs: readonly SketchPointRef[];
    readonly at: [number, number];
    readonly branched: boolean;
}

/** Everything the offset decided, in terms of copy indices rather than entity ids. */
interface OffsetPlan {
    readonly copies: OffsetCopy[];
    /** Coincidences stitching adjacent copies: one endpoint on each copy. */
    readonly joints: [CopyPoint, CopyPoint][];
    /** One entry per line copy: what holds it to its source. */
    readonly lines: readonly LineTies[];
    /** Joints left unjoined because three or more picked edges meet there. */
    readonly branched: number;
    /**
     * Joints whose offset carriers do not meet — two offset curves that stay apart
     * (parallel, concentric). Their raw offset endpoints already meet, so nothing is lost.
     */
    readonly noJoin: number;
}

export interface OffsetOutcome {
    /** Ids of the copies, in source order. */
    readonly createdEntityIds: number[];
    /**
     * The distance dimension each line copy landed as — the constraint id, plus the refs
     * the caller needs to place its label (`pointLineFoot` + `labelOnSegment`). The refs
     * are ordered so the dimension reads positive (see `distanceRefs`).
     */
    readonly dimensions: {
        readonly constraintId: number;
        readonly point: SketchPointRef;
        readonly line: [SketchPointRef, SketchPointRef];
    }[];
    readonly branched: number;
    readonly noJoin: number;
}

// ------------------------------------------------------------------ Geometry

/** What the endpoint and param readings need of an entity: its kind, and how its params lay out. */
type EntityParams = Pick<SketchEntityData, "type" | "params">;

/**
 * Endpoints taking part in a chain: the two ends of anything *open* — a line's, an arc's, an
 * ellipseArc's, and the numeric families' own first and last control points. A closed curve
 * (a circle, an ellipse) has none, so it never chains: there is no end of it for a
 * neighbour to meet.
 */
function endpointIndices(entity: EntityParams): readonly number[] {
    return entityEndIndices(entity) ?? [];
}

/** The endpoint an entity's own direction starts from (an arc's centre is point 0). */
function startPointIndex(entity: EntityParams): number {
    return entityEndIndices(entity)?.[0] ?? 0;
}

/** Every endpoint ref of `entity` that a chain can hang off. */
function endpointRefs(entity: SketchEntityData): SketchPointRef[] {
    return endpointIndices(entity).map((pointIndex) => ({ entityId: entity.id, pointIndex }));
}

/**
 * The params a copy of `entity` gets at offset `d`, in the entity's own frame: positive
 * is *to the left of the direction the entity is stored in*, which is what makes one
 * sign mean one side of a whole chain.
 *
 * A line's is its left normal. An arc's direction is the counter-clockwise sweep from
 * its start to its end, and travelling that way the left side is the one toward the
 * centre — an arc offset outwards is a *negative* distance here, and it has to be: a
 * fillet arc sits between its two lines, and only "left" puts its copy on the same side
 * of the chain as theirs. A circle has no direction to be left of (`pointIndex 0` is its
 * centre and nothing else), so its positive is outward, the reading a lone circle ought
 * to have.
 *
 * What counts as too short or too small to offset is the sketch's own scale
 * (`Precision.Distance`), never a screen-relative tolerance: that one answers "are these
 * two endpoints the same corner?", and a zoomed-out view must not be able to turn real
 * geometry into degenerate geometry the tool then refuses.
 */
function offsetParams(entity: SketchEntityData, d: number): Result<OffsetGeometry> {
    if (entity.type === "line") {
        const [x1, y1, x2, y2] = entity.params;
        const length = Math.hypot(x2 - x1, y2 - y1);
        if (length <= Precision.Distance) return Result.err("The picked line is too short to offset");
        const nx = -(y2 - y1) / length;
        const ny = (x2 - x1) / length;
        return Result.ok({ type: "line", params: [x1 + d * nx, y1 + d * ny, x2 + d * nx, y2 + d * ny] });
    }
    if (entity.type === "circle" || entity.type === "arc") {
        const [cx, cy] = entity.params;
        const radius = entityRadius(entity);
        if (radius <= Precision.Distance) return Result.err("The picked circle has no radius to offset");
        const shifted = entity.type === "circle" ? radius + d : radius - d;
        if (shifted <= Precision.Distance) return Result.err("The offset distance is more than the radius");
        if (entity.type === "circle") return Result.ok({ type: "circle", params: [cx, cy, shifted] });

        // an arc keeps its angular span: both ends ride the radius out
        const scale = shifted / radius;
        return Result.ok({
            type: "arc",
            params: [
                cx,
                cy,
                cx + (entity.params[2] - cx) * scale,
                cy + (entity.params[3] - cy) * scale,
                cx + (entity.params[4] - cx) * scale,
                cy + (entity.params[5] - cy) * scale,
            ],
        });
    }
    return offsetCurveGeometry(entity, d);
}

/** Above which the offset is sampled to find the crossings inside it. */
const OFFSET_PROBE_SAMPLES = 64;

/**
 * The offset of a curve garlic cannot tie, as an entity of its own kind: an `offsetCurve`
 * carries its source's params and says how far off it runs, and the *evaluation* is the
 * parallel curve (`curveEval.offsetAdapter`) — exact, and live, because it reads the source
 * wherever the source has got to.
 *
 * This is OpenCASCADE's answer too: `Geom_OffsetCurve` is a basis curve plus a distance,
 * because the offset of a curve is not a curve of its own kind and approximating one costs
 * control points the user then has to look at. The entity has none to look at — nothing of
 * it is a point — and its distance is the one handle.
 *
 * What the offset *can* still be is not a curve: past the source's own curvature the parallel
 * curve folds through itself. Onshape refuses those and so does this, before an entity exists
 * to hold one.
 */
function offsetCurveGeometry(entity: SketchEntityData, d: number): Result<OffsetGeometry> {
    if (offsetFolds(entity, d)) {
        return Result.err("The offset distance is larger than the geometry it comes from");
    }
    return Result.ok({
        type: "offsetCurve",
        params: [...entity.params],
        ...(entity.nurbs === undefined ? {} : { nurbs: { ...entity.nurbs, knots: [...entity.nurbs.knots] } }),
        offset: {
            sourceId: entity.id,
            sourceType: entity.type as Exclude<SketchEntityType, "offsetCurve">,
            distance: d,
        },
    });
}

/**
 * Where the offset's handle sits on a curve that has no analytic frame of its own, and which
 * way a positive distance moves it: the curve's own middle, along the very normal
 * `offsetPointAt` offsets by. The command draws its arrow here, so the drag and the op cannot
 * read "the same side" differently — which, for the numeric families, is the only reading of
 * "the side" there is.
 */
export function curveOffsetAnchor(
    entity: SketchEntityData,
): { point: [number, number]; direction: [number, number] } | undefined {
    const [start, end] = entityDomain(entity);
    const middle = (start + end) / 2;
    const point = evaluateEntity(entity, middle);
    const tangent = entityTangentAt(entity, middle);
    const norm = Math.hypot(tangent[0], tangent[1]);
    if (norm < 1e-12) return undefined;
    const nx = -tangent[1] / norm;
    const ny = tangent[0] / norm;
    const side = offsetSideSign(entity, point, nx, ny);
    return { point, direction: [side * nx, side * ny] };
}

/**
 * Where a point near an offset copy sits in the window that copy is drawn over — the source's
 * own parameter, which is what `OffsetCurveRef.window` is read and written in. The copy's
 * parameter *is* its source's (`offsetAdapter`), so this is the point's projection onto the
 * copy's support, Newton-polished rather than sampled: nothing can pin a copy's end, so the
 * number this answers *is* where the end lands.
 *
 * A periodic source **wraps**: the projection hands back a parameter inside one turn of the
 * *source's* origin, not of the copy's own span, so a value a whole period off is the same
 * place as the one meant. Asking which end is being moved cannot tell those apart — a window
 * spanning more than half a turn reads a point just past its origin end as one well inside it
 * — so the turn taken is the one nearest the span's middle, which is right for an end inside
 * the window and for one dragged past it alike.
 */
export function windowParameterAt(copy: SketchEntityData, point: readonly [number, number]): number {
    const [start, end] = entityDomain(copy);
    const at = projectSupport(copy, point).t;
    const period = entityPeriod(copy);
    if (period <= 0) return at;
    return at + Math.round(((start + end) / 2 - at) / period) * period;
}

/** The point at distance `d` off `entity`'s own normal, at the source's parameter `t`. */
function offsetPointAt(entity: SketchEntityData, d: number, t: number): [number, number] {
    const point = evaluateEntity(entity, t);
    const tangent = entityTangentAt(entity, t);
    const norm = Math.hypot(tangent[0], tangent[1]);
    const nx = norm < 1e-12 ? 0 : -tangent[1] / norm;
    const ny = norm < 1e-12 ? 0 : tangent[0] / norm;
    const reach = offsetSideSign(entity, point, nx, ny) * d;
    return [point[0] + reach * nx, point[1] + reach * ny];
}

/**
 * Whether the offset stops being a curve somewhere — the offset running off what the geometry
 * can carry. Onshape refuses such an offset rather than trimming the loop out, the same answer
 * this tool gives, and there are two ways to see one coming.
 *
 * **Curvature.** Offsetting a stretch by more than its local radius of curvature folds it
 * through itself. Travelling along the offset, `1 − ρκ` is what is left of the curve's own
 * speed — ρ the reach along the left normal, κ the signed curvature — so where that reaches
 * zero the offset has a cusp, and past it the curve runs backwards.
 *
 * **Crossing.** The offset polyline may still run into itself somewhere the curvature never
 * folds, a long offset closing a narrow gap. Two of its segments that do not share an end may
 * not cross; a closed source's first and last samples are the same point, so its seam is not
 * one, and no other pair of neighbours is ever tested.
 */
export function offsetFolds(entity: SketchEntityData, d: number): boolean {
    const geometry = offsetProbeGeometry(entity, d);
    return exceedsCurvature(geometry) || crossesItself(geometry.points, isClosedCurveType(entity.type));
}

/** One probe of the offset: where its points are, and what the curve is doing there. */
interface OffsetProbe {
    readonly points: [number, number][];
    readonly tangents: [number, number][];
    /** The signed reach along the left normal at each probe — `d` the way the offset goes. */
    readonly reaches: number[];
    /** The source's own parameters, in order. */
    readonly parameters: number[];
}

/** The offset, probed evenly over the source's parameter for the two fold tests above. */
function offsetProbeGeometry(entity: SketchEntityData, d: number): OffsetProbe {
    const [start, end] = entityDomain(entity);
    const points: [number, number][] = [];
    const tangents: [number, number][] = [];
    const reaches: number[] = [];
    const parameters: number[] = [];
    for (let i = 0; i < OFFSET_PROBE_SAMPLES; i++) {
        const t = start + ((end - start) * i) / (OFFSET_PROBE_SAMPLES - 1);
        const point = evaluateEntity(entity, t);
        const tangent = entityTangentAt(entity, t);
        const norm = Math.hypot(tangent[0], tangent[1]);
        points.push(offsetPointAt(entity, d, t));
        tangents.push(tangent);
        reaches.push(offsetSideSign(entity, point, -tangent[1] / norm, tangent[0] / norm) * d);
        parameters.push(t);
    }
    return { points, tangents, reaches, parameters };
}

/** Whether the offset has a cusp inside the probed stretch (see `offsetFolds`). */
function exceedsCurvature(probe: OffsetProbe): boolean {
    const angles = unwrappedAngles(probe.tangents);
    for (let i = 1; i < angles.length - 1; i++) {
        const step = probe.parameters[i + 1] - probe.parameters[i - 1];
        const speed = Math.hypot(probe.tangents[i][0], probe.tangents[i][1]);
        if (step === 0 || speed < 1e-12) continue;
        // κ = dθ/ds, the turn per unit of length rather than per unit of parameter
        const curvature = (angles[i + 1] - angles[i - 1]) / step / speed;
        if (1 - probe.reaches[i] * curvature <= OFFSET_FOLD_EPSILON) return true;
    }
    return false;
}

/** The tangent angles, unwrapped so a turn through ±π does not read as a jump backwards. */
function unwrappedAngles(tangents: readonly [number, number][]): number[] {
    const full = Math.PI * 2;
    const angles: number[] = [];
    let previous = 0;
    for (const [index, tangent] of tangents.entries()) {
        const angle = Math.atan2(tangent[1], tangent[0]);
        if (index === 0) {
            previous = angle;
        } else {
            const turn = ((((angle - previous + Math.PI) % full) + full) % full) - Math.PI;
            previous += turn;
        }
        angles.push(previous);
    }
    return angles;
}

/** How close to a cusp the curvature test lets an offset come before it refuses. */
const OFFSET_FOLD_EPSILON = 1e-6;

/** Whether the probed offset polyline crosses itself (see `offsetFolds`). */
function crossesItself(points: readonly [number, number][], closed: boolean): boolean {
    for (let first = 1; first < points.length; first++) {
        for (let second = first + 2; second < points.length; second++) {
            if (closed && first === 1 && second === points.length - 1) continue;
            const crossing = segmentCrossing(
                points[first - 1],
                points[first],
                points[second - 1],
                points[second],
            );
            if (crossing !== undefined) return true;
        }
    }
    return false;
}

/**
 * Where a point sits in an entity's params (`pointIndex` → param offset). Only an arc is
 * out of step: its centre leads the layout, so point 1 (its start) is params 2..3. Every
 * other family — the line, the ellipseArc, the numeric curves whose point *i* is control
 * point *i* — lays its points out from param 0.
 */
function paramOffsetOf(type: SketchEntityType, pointIndex: number): number {
    return type === "arc" ? 2 + (pointIndex - 1) * 2 : pointIndex * 2;
}

/**
 * The point of a *copy* that answers one of its source's — the index a copy's own refs and
 * ties are written with. A line, a circle and an arc are laid out as their source is, so the
 * index carries over; an `offsetCurve` copy is laid out as nothing at all, since its params
 * are its source's and not a parameter of its own.
 */
function copyPointIndex(copy: OffsetCopy, sourceIndex: number): number | undefined {
    // An offset copy has no point at all — nothing of it is a parameter — so a corner through
    // one cannot be stitched, whatever index the source's end had.
    if (copy.offset !== undefined) return undefined;
    return sourceIndex;
}

/** Moves one of a copy's points — its own index, see `copyPointIndex` — onto `at`. */
function moveCopyPoint(copy: OffsetCopy, pointIndex: number, at: readonly [number, number]): void {
    const offset = paramOffsetOf(copy.type, pointIndex);
    copy.params[offset] = at[0];
    copy.params[offset + 1] = at[1];
}

/** An offset curve's carrier: the infinite line, or the whole circle an arc rides. */
type Carrier =
    | { readonly kind: "line"; readonly a: [number, number]; readonly b: [number, number] }
    | { readonly kind: "circle"; readonly center: [number, number]; readonly radius: number };

function carrierOf(type: SketchEntityType, params: readonly number[]): Carrier {
    if (type === "line") {
        return { kind: "line", a: [params[0], params[1]], b: [params[2], params[3]] };
    }
    const radius = type === "circle" ? params[2] : Math.hypot(params[2] - params[0], params[3] - params[1]);
    return { kind: "circle", center: [params[0], params[1]], radius };
}

/** The crossing of two lines, or undefined when they are parallel (or degenerate). */
function lineLineIntersection(
    a1: [number, number],
    a2: [number, number],
    b1: [number, number],
    b2: [number, number],
): [number, number] | undefined {
    const d1 = [a2[0] - a1[0], a2[1] - a1[1]];
    const d2 = [b2[0] - b1[0], b2[1] - b1[1]];
    const denom = d1[0] * d2[1] - d1[1] * d2[0];
    const scale = Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]);
    // a sine below the sketch's own angle tolerance is parallel, and so is a collapsed line
    if (scale <= Precision.Float || Math.abs(denom) <= Precision.Angle * scale) return undefined;
    const t = ((b1[0] - a1[0]) * d2[1] - (b1[1] - a1[1]) * d2[0]) / denom;
    return [a1[0] + t * d1[0], a1[1] + t * d1[1]];
}

/** Where a line's carrier crosses a circle's. */
function lineCircleIntersections(
    a: [number, number],
    b: [number, number],
    center: [number, number],
    radius: number,
): [number, number][] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length <= Precision.Float) return [];
    const t = ((center[0] - a[0]) * dx + (center[1] - a[1]) * dy) / (length * length);
    const foot: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const h2 = radius * radius - (foot[0] - center[0]) ** 2 - (foot[1] - center[1]) ** 2;
    if (h2 < 0) return [];
    const h = Math.sqrt(h2);
    const nx = -dy / length;
    const ny = dx / length;
    return h <= Precision.Float
        ? [foot]
        : [
              [foot[0] + nx * h, foot[1] + ny * h],
              [foot[0] - nx * h, foot[1] - ny * h],
          ];
}

/** Where two circles' carriers cross; concentric circles cross nowhere. */
function circleCircleIntersections(
    first: [number, number],
    firstRadius: number,
    second: [number, number],
    secondRadius: number,
): [number, number][] {
    const dx = second[0] - first[0];
    const dy = second[1] - first[1];
    const distance = Math.hypot(dx, dy);
    if (distance <= Precision.Float) return [];
    if (distance > firstRadius + secondRadius || distance < Math.abs(firstRadius - secondRadius)) {
        return [];
    }
    const along =
        (firstRadius * firstRadius - secondRadius * secondRadius + distance * distance) / (2 * distance);
    const h2 = firstRadius * firstRadius - along * along;
    const h = h2 <= 0 ? 0 : Math.sqrt(h2);
    const mid: [number, number] = [first[0] + (along * dx) / distance, first[1] + (along * dy) / distance];
    if (h === 0) return [mid];
    return [
        [mid[0] - (h * dy) / distance, mid[1] + (h * dx) / distance],
        [mid[0] + (h * dy) / distance, mid[1] - (h * dx) / distance],
    ];
}

/** Every crossing of two carriers. */
function carrierIntersections(first: Carrier, second: Carrier): [number, number][] {
    if (first.kind === "line" && second.kind === "line") {
        const crossing = lineLineIntersection(first.a, first.b, second.a, second.b);
        return crossing === undefined ? [] : [crossing];
    }
    if (first.kind === "line" && second.kind === "circle") {
        return lineCircleIntersections(first.a, first.b, second.center, second.radius);
    }
    if (first.kind === "circle" && second.kind === "line") {
        return lineCircleIntersections(second.a, second.b, first.center, first.radius);
    }
    if (first.kind === "circle" && second.kind === "circle") {
        return circleCircleIntersections(first.center, first.radius, second.center, second.radius);
    }
    return [];
}

/**
 * The crossing the joined corner takes: the one nearest the corner the sources shared.
 * An offset pair can cross twice where the offset pushed one curve past another (two
 * arcs, say), and the far crossing is the wrong corner of the chain.
 */
function nearestCrossing(
    crossings: readonly [number, number][],
    near: readonly [number, number],
): [number, number] | undefined {
    let best: [number, number] | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const crossing of crossings) {
        const distance = Math.hypot(crossing[0] - near[0], crossing[1] - near[1]);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = crossing;
        }
    }
    return best;
}

/** Whether a copy of this kind has an analytic carrier to intersect (`carrierOf`). */
function hasCarrier(type: SketchEntityType): boolean {
    return type === "line" || type === "circle" || type === "arc";
}

/** A copy as the curve math reads it, for the crossing search below. */
function copyCurve(copy: OffsetCopy): CurveEntity {
    return { type: copy.type, params: copy.params, nurbs: copy.nurbs, offset: copy.offset };
}

// ------------------------------------------------------------------ Chain analysis

/** Position of a point ref, as the sketch's own (u, v). */
function pointAt(solver: SketchSolver, ref: SketchPointRef): [number, number] {
    return solver.pointOf(ref);
}

/**
 * The joints among the picked entities: endpoints that meet. The coincidence constraint
 * is what normally says so, but a corner can also be merely *drawn* coincident (trimmed
 * geometry, an imported sketch), so a positional comparison backs it up — the same pair
 * of tests `cornerOps.cornerBetween` makes for a fillet's corner.
 *
 * The coincidences are read straight off the constraints rather than through
 * `coincidentGroup`: an arc's structural `PointOnArc` ties its centre to its own ends,
 * so that walk hands back the whole arc and two arcs that merely *meet* would each come
 * back as one group of three or more — a branch that is not there.
 */
function findJoints(
    solver: SketchSolver,
    sources: readonly SketchEntityData[],
    tolerance: number,
): SourceJoint[] {
    return endpointGroups(solver, sources, tolerance)
        .filter((group) => group.length >= 2)
        .map((group) => ({
            refs: group,
            at: pointAt(solver, group[0]),
            branched: group.length > 2,
        }));
}

/** The picked entities' endpoints, grouped by which ones meet (see `findJoints`). */
function endpointGroups(
    solver: SketchSolver,
    sources: readonly SketchEntityData[],
    tolerance: number,
): SketchPointRef[][] {
    const refs = sources.flatMap(endpointRefs);
    const indexOf = new Map(refs.map((ref, index) => [pointRefKey(ref), index]));
    const finder = unionFind(refs);

    // coincidence first: it names the two endpoints exactly
    for (const constraint of solver.toData().constraints) {
        if (constraint.kind !== ConstraintKind.P2PCoincident || constraint.refs.length !== 2) continue;
        const first = indexOf.get(pointRefKey(constraint.refs[0]));
        const second = indexOf.get(pointRefKey(constraint.refs[1]));
        if (first !== undefined && second !== undefined) finder.union(first, second);
    }
    // then position: a corner can also be merely *drawn* coincident
    for (let i = 0; i < refs.length; i++) {
        for (let j = i + 1; j < refs.length; j++) {
            const [a, b] = [pointAt(solver, refs[i]), pointAt(solver, refs[j])];
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance) finder.union(i, j);
        }
    }
    return finder.groups();
}

/**
 * The union-find the endpoint grouping runs on. Two endpoints of the *same* entity never
 * join: an entity meeting itself is not a corner, and letting its ends merge would make a
 * whole arc one joint.
 */
function unionFind(refs: readonly SketchPointRef[]): {
    union(a: number, b: number): void;
    groups(): SketchPointRef[][];
} {
    const parent = refs.map((_, index) => index);
    const root = (index: number): number => {
        let current = index;
        while (parent[current] !== current) current = parent[current];
        return current;
    };
    return {
        union(a: number, b: number): void {
            if (refs[a].entityId === refs[b].entityId) return;
            const [ra, rb] = [root(a), root(b)];
            if (ra !== rb) parent[rb] = ra;
        },
        groups(): SketchPointRef[][] {
            const grouped = new Map<number, SketchPointRef[]>();
            refs.forEach((ref, index) => {
                const group = grouped.get(root(index)) ?? [];
                group.push(ref);
                grouped.set(root(index), group);
            });
            return [...grouped.values()];
        },
    };
}

/**
 * The traversal sign of every picked entity: +1 when the entity's own direction is the
 * direction the chain is walked in, −1 when it is walked backwards. A chain is walked
 * from the anchor — the first picked entity, in its own direction — and each neighbour
 * continues from the endpoint it meets, so every entity of one component agrees on which
 * side "left" is. Components the anchor is not in are walked from their own first
 * entity, which is what keeps the second loop of a two-loop pick from mixing its sides.
 *
 * Entities at a branched joint stay on their own direction and are not followed: there
 * is no single "the" other side to continue from.
 */
function orientEntities(
    sources: readonly SketchEntityData[],
    joints: readonly SourceJoint[],
): Map<number, number> {
    const byId = new Map(sources.map((source) => [source.id, source]));
    const jointAt = new Map<string, SourceJoint>();
    for (const joint of joints) {
        if (joint.branched) continue;
        for (const ref of joint.refs) jointAt.set(pointRefKey(ref), joint);
    }

    const signOf = new Map<number, number>();
    for (const anchor of sources) {
        if (signOf.has(anchor.id)) continue;
        walkChain(anchor, signOf, byId, jointAt);
    }
    return signOf;
}

/**
 * Walks the chain `anchor` belongs to, in the anchor's own direction, writing a sign for
 * every entity it reaches. Breadth-first over a growing array rather than a queue: the
 * walk is short and the order only has to be deterministic.
 */
function walkChain(
    anchor: SketchEntityData,
    signOf: Map<number, number>,
    byId: ReadonlyMap<number, SketchEntityData>,
    jointAt: ReadonlyMap<string, SourceJoint>,
): void {
    signOf.set(anchor.id, 1);
    const queue = [anchor.id];
    for (let head = 0; head < queue.length; head++) {
        const entity = byId.get(queue[head]);
        if (entity === undefined) continue;
        const sign = signOf.get(entity.id) ?? 1;
        // the endpoint the walk leaves by: an entity walked backwards is left at the
        // end it would otherwise have started from
        const exit = sign === 1 ? otherEndIndex(entity) : startPointIndex(entity);
        const joint = jointAt.get(pointRefKey({ entityId: entity.id, pointIndex: exit }));
        if (joint === undefined) continue;
        for (const ref of joint.refs) {
            const neighbour = byId.get(ref.entityId);
            if (neighbour === undefined || signOf.has(neighbour.id)) continue;
            signOf.set(neighbour.id, ref.pointIndex === startPointIndex(neighbour) ? 1 : -1);
            queue.push(neighbour.id);
        }
    }
}

/** The endpoint opposite `pointIndex` on an entity with two of them. */
function otherEndIndex(entity: EntityParams): number {
    return entityEndIndices(entity)?.[1] ?? 0;
}

// ------------------------------------------------------------------ Planning

/** Key of a copy's endpoint, for "was this end joined?" bookkeeping. */
function copyPointKey(point: CopyPoint): string {
    return `${point.copyIndex}:${point.pointIndex}`;
}

/** A picked entity the offset can copy: any real geometry — every kind has an offset now. */
function isOffsettable(entity: SketchEntityData | undefined): entity is SketchEntityData {
    return entity !== undefined;
}

/**
 * Everything the offset would do, worked out before the solver is touched: the copies
 * with their final (joined) params, the constraints to tie them, and what could not be
 * done. Pure geometry and `solver` reads — the preview draws exactly this.
 */
function planOffset(
    solver: SketchSolver,
    sourceIds: readonly number[],
    distance: number,
    tolerance: number,
): Result<OffsetPlan> {
    const sources = offsettableSources(solver, sourceIds);
    if (sources.length === 0) return Result.err("Nothing to offset");

    const joints = findJoints(solver, sources, tolerance);
    const copies = plannedCopies(solver, sources, orientEntities(sources, joints), distance);
    if (!copies.isOk) return Result.err(copies.error);

    const corners = joinCorners(copies.value, joints);
    for (const copy of copies.value) {
        const problem = validateCopy(copy);
        if (problem !== undefined) return Result.err(problem);
    }
    const duplicate = findDuplicate(copies.value, solver);
    if (duplicate !== undefined) return Result.err(duplicate);

    return Result.ok({
        copies: copies.value,
        joints: corners.joints,
        lines: lineTies(copies.value, corners.joined),
        branched: corners.branched,
        noJoin: corners.noJoin,
    });
}

/** The picked entities an offset can copy: real geometry of a kind that has an offset. */
function offsettableSources(solver: SketchSolver, sourceIds: readonly number[]): SketchEntityData[] {
    return [...new Set(sourceIds)]
        .filter((id) => !solver.isFixed(id))
        .map((id) => solver.entity(id))
        .filter(isOffsettable);
}

/** The copy of every source, shifted `distance` to its own left (see `offsetParams`). */
function plannedCopies(
    solver: SketchSolver,
    sources: readonly SketchEntityData[],
    signOf: ReadonlyMap<number, number>,
    distance: number,
): Result<OffsetCopy[]> {
    const copies: OffsetCopy[] = [];
    for (const source of sources) {
        const geometry = offsetParams(source, (signOf.get(source.id) ?? 1) * distance);
        if (!geometry.isOk) return Result.err(geometry.error);
        copies.push({
            source,
            construction: solver.isConstruction(source.id),
            type: geometry.value.type,
            params: geometry.value.params,
            ...(geometry.value.nurbs === undefined ? {} : { nurbs: geometry.value.nurbs }),
            ...(geometry.value.offset === undefined ? {} : { offset: geometry.value.offset }),
        });
    }
    return Result.ok(copies);
}

/** What joining the corners did: the stitches to add, and what could not be joined. */
interface JoinedCorners {
    readonly joints: [CopyPoint, CopyPoint][];
    /** The copy endpoints a corner pinned — the others are free to tie to their source's. */
    readonly joined: ReadonlySet<string>;
    readonly branched: number;
    readonly noJoin: number;
}

/**
 * Moves every pair of joined copies onto the crossing of their carriers (see the module
 * header), leaving the stitch to be added with the other constraints. The pairs that
 * cannot be joined are counted rather than guessed at.
 */
function joinCorners(copies: OffsetCopy[], joints: readonly SourceJoint[]): JoinedCorners {
    const copyIndexOf = new Map(copies.map((copy, index) => [copy.source.id, index]));
    const joined = new Set<string>();
    const crossings: [CopyPoint, CopyPoint][] = [];
    let branched = 0;
    let noJoin = 0;
    for (const joint of joints) {
        if (joint.branched) {
            branched++;
            continue;
        }
        const pair = cornerPair(joint, copyIndexOf, copies);
        const crossing = pair === undefined ? undefined : cornerCrossing(copies, pair, joint.at);
        // Three things a missing pair can mean, and only one of them is a corner left
        // unjoined: a joint whose copies are not both here is not the join's to make; a copy
        // with no point to stitch (an offset copy) is one it cannot make at all; and a pair
        // whose offset carriers stay apart is one it set out to make and could not.
        if (pair === undefined) {
            if (joint.refs.every((ref) => copyIndexOf.has(ref.entityId))) noJoin++;
            continue;
        }
        if (crossing === undefined) {
            noJoin++;
            continue;
        }
        const [first, second] = pair;
        moveCopyPoint(copies[first.copyIndex], first.pointIndex, crossing);
        moveCopyPoint(copies[second.copyIndex], second.pointIndex, crossing);
        joined.add(copyPointKey(first));
        joined.add(copyPointKey(second));
        crossings.push([first, second]);
    }
    return { joints: crossings, joined, branched, noJoin };
}

/**
 * Where two offset copies meet, near the corner their sources shared. The crossing is
 * taken from the copies' *carriers* — the whole line, the whole circle — never from the
 * trimmed curves (see the module header). The carriers of offset neighbours stay apart
 * only when the sources were parallel or concentric there; the raw offset endpoints meet
 * in that case, so the corner holds either way.
 *
 * An `offsetCurve` copy has no carrier either — it is a parallel curve of no analytic kind, and
 * its own params are its source's — so a pair involving one is met through the curves' own
 * *support* crossings instead, which is the same reading: a line as its infinite extension, an
 * ellipseArc as its whole ellipse, a NURBS as its end span carried on.
 */
function cornerCrossing(
    copies: readonly OffsetCopy[],
    pair: readonly [CopyPoint, CopyPoint],
    at: readonly [number, number],
): [number, number] | undefined {
    const [first, second] = pair;
    const one = copies[first.copyIndex];
    const other = copies[second.copyIndex];
    const crossings =
        hasCarrier(one.type) && hasCarrier(other.type)
            ? carrierIntersections(carrierOf(one.type, one.params), carrierOf(other.type, other.params))
            : intersectCurves(copyCurve(one), copyCurve(other), true).map((crossing) => crossing.point);
    return nearestCrossing(crossings, at);
}

/** The two copy endpoints a joint pins — the copies of the entities it joins. */
function cornerPair(
    joint: SourceJoint,
    copyIndexOf: ReadonlyMap<number, number>,
    copies: readonly OffsetCopy[],
): [CopyPoint, CopyPoint] | undefined {
    const [refA, refB] = joint.refs;
    const copyA = copyIndexOf.get(refA.entityId);
    const copyB = copyIndexOf.get(refB.entityId);
    if (copyA === undefined || copyB === undefined) return undefined;
    const [firstIndex, secondIndex] = [
        copyPointIndex(copies[copyA], refA.pointIndex),
        copyPointIndex(copies[copyB], refB.pointIndex),
    ];
    if (firstIndex === undefined || secondIndex === undefined) return undefined;
    return [
        { copyIndex: copyA, pointIndex: firstIndex },
        { copyIndex: copyB, pointIndex: secondIndex },
    ];
}

/** A line copy's ties: where to measure from, and which of its ends no corner pinned. */
function lineTies(copies: readonly OffsetCopy[], joined: ReadonlySet<string>): LineTies[] {
    return copies.flatMap((copy, copyIndex) =>
        copy.source.type === "line"
            ? [
                  {
                      copyIndex,
                      source: copy.source,
                      freePoints: endpointIndices(copy.source).filter(
                          (pointIndex) => !joined.has(copyPointKey({ copyIndex, pointIndex })),
                      ),
                  },
              ]
            : [],
    );
}

/**
 * Whether a joined copy still reads as an offset of its source. Joining a corner can
 * push a segment past its neighbour when the distance is larger than the geometry the
 * corner turns through — the offset then runs backwards, which is not a shape.
 */
function validateCopy(copy: OffsetCopy): string | undefined {
    if (copy.source.type === "line") {
        const [x1, y1, x2, y2] = copy.source.params;
        const [a1, b1, a2, b2] = copy.params;
        const dot = (x2 - x1) * (a2 - a1) + (y2 - y1) * (b2 - b1);
        if (dot <= 0) return "The offset distance is larger than the geometry it comes from";
        return undefined;
    }
    if (copy.source.type === "arc") {
        // an arc's start and end at the same point is the one degenerate join: the
        // offset circle is smaller, so the two ends can meet and leave no span at all
        // (an arc always sweeps counter-clockwise, so a negative raw sweep is not one)
        const [, , sx, sy, ex, ey] = copy.params;
        if (Math.hypot(ex - sx, ey - sy) <= Precision.Float) {
            return "The offset distance is larger than the geometry it comes from";
        }
    }
    return undefined;
}

/**
 * A copy landing on geometry the sketch already has — its own source when the distance
 * is nothing, a neighbour it happens to line up with, another copy. Overlapping edges
 * send profile building down the kernel path (`needsKernelSplit`), so this is refused
 * rather than left to surface later as a shape that will not build.
 *
 * The comparison is `sameEntityGeometry`, which returns false the moment two entities are of
 * different kinds — and an `offsetCurve` copy is of a kind no other curve is, so it is never
 * seen landing on anything by that route. Its own geometry is read instead (`landsOnGeometry`),
 * which is what catches the overwhelmingly common case: a copy lying on the geometry it came
 * from.
 */
function findDuplicate(copies: readonly OffsetCopy[], solver: SketchSolver): string | undefined {
    const present: CurveEntity[] = solver.entities().map((entity) => ({
        type: entity.type,
        params: entity.params,
        nurbs: entity.nurbs,
        offset: entity.offset,
    }));
    for (const copy of copies) {
        // An offset copy's params are its *source's*, so the params comparison below cannot
        // read it: it would match the source itself, which is the one thing the copy is
        // certainly not on. Its geometry is read instead.
        const duplicate =
            copy.offset === undefined
                ? present.some((other) =>
                      sameEntityGeometry(
                          other.type,
                          other.params,
                          copy.source.type,
                          copy.params,
                          Precision.Distance,
                      ),
                  )
                : landsOnGeometry(copy, present);
        if (duplicate) return "The offset lands on existing geometry";
        if (copy.offset === undefined) {
            present.push({ type: copy.source.type, params: copy.params, nurbs: copy.nurbs });
        } else {
            present.push({ type: copy.type, params: copy.params, nurbs: copy.nurbs, offset: copy.offset });
        }
    }
    return undefined;
}

/** Whether the curve an offset copy draws already lies on something the sketch has. */
function landsOnGeometry(copy: OffsetCopy, present: readonly CurveEntity[]): boolean {
    const curve: CurveEntity = {
        type: copy.type,
        params: copy.params,
        nurbs: copy.nurbs,
        offset: copy.offset,
    };
    const [start, end] = entityDomain(curve);
    for (let index = 0; index <= OFFSET_PROBE_SAMPLES; index++) {
        const point = evaluateEntity(curve, start + ((end - start) * index) / OFFSET_PROBE_SAMPLES);
        for (const other of present) {
            if (projectPoint(other, point).distance <= Precision.Distance) return true;
        }
    }
    return false;
}

/**
 * The two endpoints of the source line, ordered so the point sits to the left of the direction
 * they give — the sign is a side marker on the datum (`datumSignIsSide`), and fixing which side
 * it is makes the offset's stored number a function of the geometry alone rather than of the way
 * the source line happened to be drawn. Swapping the endpoints is free: the line is the same line.
 */
function distanceRefs(
    solver: SketchSolver,
    point: SketchPointRef,
    source: SketchEntityData,
): [SketchPointRef, SketchPointRef] {
    const [first, second] = lineRefs(source.id);
    const signed = pointLineSignedDistance(
        solver.pointOf(point),
        solver.pointOf(first),
        solver.pointOf(second),
    );
    return signed < 0 ? [second, first] : [first, second];
}

// ------------------------------------------------------------------ The op

/**
 * Offsets `sourceIds` by `distance` (sketch units, signed: positive is to the left of
 * each entity's own direction, which is outward for a circle and toward the centre for
 * an arc — see `offsetParams`) and ties the copies to their sources. `tolerance` is in
 * sketch units and decides both what counts as a shared corner and how short a line may
 * be, so the caller passes its screen tolerance, floored, as the corner commands do.
 *
 * It is *not* what decides whether the distance is an offset at all: that is the
 * sketch's own coincidence scale (`Precision.Distance`), since a copy closer than that
 * is the geometry it came from. Judging it by the screen instead would make the tool
 * refuse a real distance just because the view was zoomed out.
 *
 * The caller solves and commits: this op solves once itself, only so that a copy the
 * solver cannot hold is rolled back here rather than left half-applied in the sketch.
 */
export function offsetEntities(
    solver: SketchSolver,
    sourceIds: readonly number[],
    distance: number,
    tolerance: number,
): Result<OffsetOutcome> {
    const tol = Math.max(tolerance, 1e-6);
    if (Math.abs(distance) <= Precision.Distance) {
        return Result.err("The offset distance is too small");
    }

    const plan = planOffset(solver, sourceIds, distance, tol);
    if (!plan.isOk) return Result.err(plan.error);
    const { copies, joints, lines: lineTies, branched, noJoin } = plan.value;

    const snapshot = solver.toData();
    const copyIds = copies.map((copy) => addCopy(solver, copy));
    for (const [first, second] of joints) {
        solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [copyPointRef(copyIds, first), copyPointRef(copyIds, second)],
        });
    }
    const dimensions = tieLines(solver, lineTies, copyIds);
    if (!dimensions.isOk) {
        solver.reset(snapshot);
        return Result.err(dimensions.error);
    }
    tieRoundCopies(solver, copies, copyIds);

    const outcome = solver.solve(true);
    if (outcome.result === "Conflicting" || outcome.result === "Diverged" || outcome.result === "Stalled") {
        solver.reset(snapshot);
        return Result.err(`The sketch could not solve after the offset (${outcome.result})`);
    }
    return Result.ok({
        createdEntityIds: copyIds,
        dimensions: dimensions.value,
        branched,
        noJoin,
    });
}

/** One of a copy's points as a ref the solver takes — its id is known only after creation. */
function copyPointRef(copyIds: readonly number[], point: CopyPoint): SketchPointRef {
    return { entityId: copyIds[point.copyIndex], pointIndex: point.pointIndex };
}

/**
 * Holds every line copy to its source, one `tieLine` at a time, and collects the
 * dimensions they land as for the caller to anchor.
 */
function tieLines(
    solver: SketchSolver,
    ties: readonly LineTies[],
    copyIds: readonly number[],
): Result<OffsetOutcome["dimensions"]> {
    const dimensions: OffsetOutcome["dimensions"][number][] = [];
    for (const tie of ties) {
        const tied = tieLine(solver, tie, copyIds);
        if (!tied.isOk) return Result.err(tied.error);
        dimensions.push(tied.value);
    }
    return Result.ok(dimensions);
}

/**
 * One line copy held to its source: `Parallel` for the direction, a `P2LDistance` for the
 * offset — a datum, so it lands as an editable dimension — and a `Perpendicular` per free
 * end, which is what stops the copy sliding along its own line (see `LineTies`).
 *
 * A copy whose measuring point ended up on the source line (a distance under the sketch's
 * own coincidence scale) is refused rather than tied to nothing.
 */
function tieLine(
    solver: SketchSolver,
    tie: LineTies,
    copyIds: readonly number[],
): Result<OffsetOutcome["dimensions"][number]> {
    const copyId = copyIds[tie.copyIndex];
    solver.addConstraint({
        kind: ConstraintKind.Parallel,
        refs: [...lineRefs(tie.source.id), ...lineRefs(copyId)],
    });
    const point = copyPointRef(copyIds, { copyIndex: tie.copyIndex, pointIndex: 0 });
    const line = distanceRefs(solver, point, tie.source);
    const { datum, reading } = pointLineReading(
        solver.pointOf(point),
        solver.pointOf(line[0]),
        solver.pointOf(line[1]),
    );
    if (reading <= Precision.Distance) {
        return Result.err("The offset distance is too small");
    }
    const constraintId = solver.addConstraint({
        kind: ConstraintKind.P2LDistance,
        refs: [point, line[0], line[1]],
        datum,
    });
    tieFreeEnds(solver, tie, copyId);
    return Result.ok({ constraintId, point, line });
}

/**
 * Pins every end no corner did, so a copy cannot slide along its own line or change
 * length behind the source's back — the reason each is a `Perpendicular` rather than a
 * distance is in `LineTies`.
 */
function tieFreeEnds(solver: SketchSolver, tie: LineTies, copyId: number): void {
    for (const pointIndex of tie.freePoints) {
        solver.addConstraint({
            kind: ConstraintKind.Perpendicular,
            refs: [
                ...lineRefs(tie.source.id),
                { entityId: tie.source.id, pointIndex },
                { entityId: copyId, pointIndex },
            ],
        });
    }
}

/**
 * Holds every circle and arc copy concentric with its source. It is all there is to tie
 * them by: a radius that follows the source's would take a "difference of radii" the
 * solver has no constraint for (see the module header).
 */
function tieRoundCopies(
    solver: SketchSolver,
    copies: readonly OffsetCopy[],
    copyIds: readonly number[],
): void {
    for (const [index, copy] of copies.entries()) {
        const kind = copy.source.type;
        // a circle or an arc reads "centre" and nothing else; an `offsetCurve` copy's point 0
        // would be its first *control point* (of the source it reads), not a centre
        if (kind !== "circle" && kind !== "arc") continue;
        solver.addConstraint({
            kind: ConstraintKind.P2PCoincident,
            refs: [centerRef(copy.source.id), centerRef(copyIds[index])],
        });
    }
}

/** Adds one copy's geometry and keeps its construction flag; the ties come after. */
function addCopy(solver: SketchSolver, copy: OffsetCopy): number {
    const id = solver.addEntityFromParams(copy.type, copy.params, copy.nurbs, copy.offset);
    if (copy.construction) solver.setConstruction(id, true);
    return id;
}

/**
 * The meshes-to-be of an offset, as entity data in sketch coordinates — what the drag
 * handle previews. The preview and the op decide the geometry through the same
 * `planOffset`, so a preview can never show a copy the op would not make. The ids are
 * the sources' own: nothing addresses a preview copy, it is only ever meshed. An offset
 * the op would refuse previews as nothing at all, which is what refusing looks like
 * before the confirm rather than after it.
 */
export function offsetPreview(
    solver: SketchSolver,
    sourceIds: readonly number[],
    distance: number,
    tolerance: number,
): SketchEntityData[] {
    const tol = Math.max(tolerance, 1e-6);
    if (Math.abs(distance) <= Precision.Distance) return [];
    const plan = planOffset(solver, sourceIds, distance, tol);
    if (!plan.isOk) return [];
    return plan.value.copies.map((copy) => ({
        id: copy.source.id,
        // the copy's own kind, not the source's: an `offsetCurve` copy previews as the entity
        // it is, so the drawn curve is the one the op would build rather than the source's
        type: copy.type,
        params: copy.params,
        ...(copy.nurbs === undefined ? {} : { nurbs: copy.nurbs }),
        ...(copy.offset === undefined ? {} : { offset: copy.offset }),
        ...(copy.construction ? { construction: true } : {}),
    }));
}
