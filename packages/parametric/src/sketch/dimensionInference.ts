// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ParameterValue } from "@chili3d/core";
import { conicShoulder } from "./curveEval";
import {
    angleVertex,
    type DimensionAnchor,
    type DimensionLabel,
    labelOnAxis,
    labelOnSegment,
    measuresSupplement,
    type Point2,
    pointLineFoot,
    pointLineReading,
    signedSweep,
} from "./editor/dimensionLayout";
import type { DimensionPreview } from "./editor/sketchAnnotations";
import {
    ConstraintKind,
    datumIsSigned,
    entityRadius,
    isDatumEntityId,
    type RadiusDisplay,
    type SketchConstraintData,
    type SketchEntityData,
    type SketchPointRef,
    toDisplayDatum,
} from "./sketchModel";
import type { SketchSolver } from "./solver";
import { normalizeLineRefs } from "./solverEntities";

/**
 * What the Dimension tool does with what it was handed: which dimension a selection
 * means, and where that dimension's label goes.
 *
 * The table, in full — a selection is read by *what it is*, never by which tool was run:
 *
 * | picked                        | dimension                     |
 * |-------------------------------|-------------------------------|
 * | one line                      | its length                    |
 * | one circle                    | its diameter (`Ø`, at 2r)     |
 * | one arc                       | its radius (`R`)              |
 * | two points                    | distance — aligned, Δx or Δy, |
 * |                               |   decided by where the label  |
 * |                               |   is dragged (see `classify…`)|
 * | a point and a line            | the perpendicular distance    |
 * | two lines, not parallel       | the angle between them        |
 * | two lines, parallel           | the distance between them     |
 * | two circles/arcs              | the distance between centers  |
 *
 * A point on a circle has no dimension of its own: the only reading available would be
 * "to the center", which is the center-to-point case the user can pick directly.
 */

/** One element a pick answered with — a point, or the entity it sits on. */
export type DimensionElement =
    | { readonly kind: "point"; readonly ref: SketchPointRef }
    | { readonly kind: "entity"; readonly entityId: number };

/** Which of the three readings two points get; see `classifyTwoPoint`. */
export type TwoPointMode = "aligned" | "horizontal" | "vertical";

/** A dimension ready to be created: everything `commitDimension` needs. */
export interface ResolvedDimension {
    readonly constraint: Omit<SketchConstraintData, "id">;
    readonly anchor: DimensionAnchor;
    /** The dialog's opening value, in the units the user reads (a diameter is 2r). */
    readonly initial: ParameterValue;
    readonly positiveOnly: boolean;
}

/**
 * A dimension the current selection means. Its label is the last unknown, so both what is
 * previewed and what is committed are derived from the label the pointer is at — one
 * function, so the preview can never show a reading that committing would not produce.
 */
export interface DimensionPlan {
    preview(label: [number, number]): DimensionPreview | undefined;
    resolve(label: [number, number]): ResolvedDimension | undefined;
}

/** Half-width of the band a two-point label must leave before it reads as axis-aligned. */
const AXIS_BAND_RATIO = 1.3;

/**
 * Which reading two points get, from where the label was dragged — the *direction* being
 * what decides, not the segment's own slant:
 *
 * - up or down from the pair (the vertical offset dominates) → the **horizontal** distance,
 *   Δx, drawn as a horizontal dimension line;
 * - left or right → the **vertical** distance, Δy;
 * - anything nearer the diagonal, where neither offset dominates → the **aligned** distance,
 *   the two points' true separation.
 *
 * So the aligned reading is reached by dragging out diagonally, which for a shallow or a
 * steep pair is a different direction from that pair's own normal — deliberately: the rule
 * states where the user put the label, and where that is reads the same for every pair.
 *
 * `AXIS_BAND_RATIO` keeps the diagonal case from flipping to an axis a hair either side of
 * 45°, and a reading that degenerates to nothing (the points share a coordinate, so that
 * axis measures zero) falls through to the one that still means something.
 */
export function classifyTwoPoint(
    a: [number, number],
    b: [number, number],
    label: [number, number],
): TwoPointMode | undefined {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    // two coincident points are one point, and one point has no distance to read
    if (Math.hypot(dx, dy) < 1e-9) return undefined;

    const across = Math.abs(label[0] - (a[0] + b[0]) / 2);
    const up = Math.abs(label[1] - (a[1] + b[1]) / 2);
    const spansX = Math.abs(dx) > 1e-9;
    const spansY = Math.abs(dy) > 1e-9;

    if (up > across * AXIS_BAND_RATIO && spansX) return "horizontal";
    if (across > up * AXIS_BAND_RATIO && spansY) return "vertical";
    if (!spansX && spansY) return "vertical";
    if (spansX && !spansY) return "horizontal";
    return "aligned";
}

/**
 * The reading the selection means, or undefined while it means nothing yet (which is the
 * signal to keep picking). Pure: it reads the solver and answers with a plan — no
 * highlighting, no prompts, no publishing, since this runs on every pointer move.
 */
export function inferDimension(
    elements: readonly DimensionElement[],
    solver: SketchSolver,
): DimensionPlan | undefined {
    if (elements.length === 1) return inferSingle(elements[0], solver);
    if (elements.length !== 2) return undefined;

    const points = elements.filter((e) => e.kind === "point");
    const entities = elements.filter((e) => e.kind === "entity");
    if (points.length === 2) {
        return buildTwoPoint(solver, points[0].ref, points[1].ref);
    }
    if (points.length === 1 && entities.length === 1) {
        return buildPointToEntity(solver, points[0].ref, entities[0].entityId);
    }
    if (entities.length === 2) {
        return buildTwoEntities(solver, entities[0].entityId, entities[1].entityId);
    }
    return undefined;
}

function inferSingle(element: DimensionElement, solver: SketchSolver): DimensionPlan | undefined {
    if (element.kind !== "entity") return undefined;
    const entity = solver.entity(element.entityId);
    if (entity === undefined) return undefined;
    switch (entity.type) {
        case "line":
            // a datum axis is infinite: there is no length in it to read
            return isDatumEntityId(entity.id) ? undefined : buildLineLength(solver, entity.id);
        case "circle":
        case "arc":
            return buildRadiusReading(entity);
        case "ellipse":
        case "ellipseArc":
            return buildEllipseMajorAxis(entity);
        case "conic":
            return buildConicRho(entity);
        default:
            // a free curve has no reading of its own — its control points are dimensioned one by one
            return undefined;
    }
}

/**
 * An ellipse family's major semi-axis, read between the center and the major-axis
 * point — the plain point-point distance over the entity's own two first refs.
 */
function buildEllipseMajorAxis(entity: SketchEntityData): DimensionPlan {
    const center: SketchPointRef = { entityId: entity.id, pointIndex: 0 };
    const major: SketchPointRef = { entityId: entity.id, pointIndex: 1 };
    const uvCenter: [number, number] = [entity.params[0], entity.params[1]];
    const uvMajor: [number, number] = [entity.params[2], entity.params[3]];
    const length = Math.hypot(uvMajor[0] - uvCenter[0], uvMajor[1] - uvCenter[1]);

    return {
        preview: (label) => ({ kind: "distance", p1: uvCenter, p2: uvMajor, position: label }),
        resolve: (label) => ({
            constraint: { kind: ConstraintKind.P2PDistance, refs: [center, major], datum: length },
            anchor: { kind: "offset", ...labelOnSegment(uvCenter, uvMajor, label) },
            initial: length,
            positiveOnly: !datumIsSigned(ConstraintKind.P2PDistance),
        }),
    };
}

/**
 * A conic's rho, read at its shoulder point: the leader says where rho lives on the
 * curve, and the datum is the ratio itself — dimensionless, and bounded to (0, 1) by
 * the dialog's own rule for the kind (`commitDimension`).
 */
function buildConicRho(entity: SketchEntityData): DimensionPlan {
    const entityId = entity.id;
    const rho = entity.params[6];
    return {
        preview: (label) => ({ kind: "rho", point: conicShoulder(entity.params), rho, position: label }),
        resolve: (label) => {
            const shoulder = conicShoulder(entity.params);
            return {
                constraint: {
                    kind: ConstraintKind.ConicRho,
                    refs: [{ entityId, pointIndex: 0 }],
                    datum: rho,
                },
                anchor: { kind: "vector", dx: label[0] - shoulder[0], dy: label[1] - shoulder[1] },
                initial: rho,
                positiveOnly: true,
            };
        },
    };
}

function buildTwoEntities(
    solver: SketchSolver,
    firstId: number,
    secondId: number,
): DimensionPlan | undefined {
    const first = solver.entity(firstId);
    const second = solver.entity(secondId);
    if (first === undefined || second === undefined) return undefined;
    if (first.type === "line" && second.type === "line") {
        return areParallel(solver, firstId, secondId)
            ? buildLineGap(solver, firstId, secondId)
            : buildAngle(solver, firstId, secondId);
    }
    // a center distance needs two centers — the conic's and the free curves' point 0 is an
    // endpoint, so those pairs are dimensioned by picking the points themselves
    if (hasCenter(first) && hasCenter(second)) {
        return buildCenterDistance(first, second);
    }
    return undefined;
}

/** Whether the entity's point 0 is its center — what a two-entity distance reads between. */
function hasCenter(entity: SketchEntityData): boolean {
    return (
        entity.type === "circle" ||
        entity.type === "arc" ||
        entity.type === "ellipse" ||
        entity.type === "ellipseArc"
    );
}

/**
 * A point against a line — or against a circle, which has no reading of its own: the only
 * distance available to a circle is to its center, and that center is a point the user can
 * pick directly, so inferring it would only guess at which of the two they meant.
 */
function buildPointToEntity(
    solver: SketchSolver,
    point: SketchPointRef,
    entityId: number,
): DimensionPlan | undefined {
    const entity = solver.entity(entityId);
    if (entity === undefined || entity.type !== "line") return undefined;
    // a point on the line (or on it through a coincidence) is zero away from it
    if (liesOnLine(solver, point, entityId)) return undefined;
    return buildPointLineDistance(solver, point, entityId);
}

/** Length of one line, read between its own two endpoints. */
function buildLineLength(solver: SketchSolver, lineId: number): DimensionPlan {
    const start: SketchPointRef = { entityId: lineId, pointIndex: 0 };
    const end: SketchPointRef = { entityId: lineId, pointIndex: 1 };
    const uvStart = solver.pointOf(start);
    const uvEnd = solver.pointOf(end);
    const length = Math.hypot(uvEnd[0] - uvStart[0], uvEnd[1] - uvStart[1]);

    return {
        preview: (label) => ({ kind: "distance", p1: uvStart, p2: uvEnd, position: label }),
        resolve: (label) => ({
            constraint: { kind: ConstraintKind.P2PDistance, refs: [start, end], datum: length },
            anchor: { kind: "offset", ...labelOnSegment(uvStart, uvEnd, label) },
            initial: length,
            positiveOnly: !datumIsSigned(ConstraintKind.P2PDistance),
        }),
    };
}

/**
 * One round entity's radius — read as a diameter for a full circle, as a radius for an
 * arc. The constraint is the same either way; only the reading differs, and the reading
 * rides on the constraint itself, which is where the solver picks up its halving.
 */
function buildRadiusReading(entity: SketchEntityData): DimensionPlan {
    const entityId = entity.id;
    const center: SketchPointRef = { entityId, pointIndex: 0 };
    const uvCenter: [number, number] = [entity.params[0], entity.params[1]];
    const radius = entityRadius(entity);
    const display: RadiusDisplay = entity.type === "circle" ? "diameter" : "radius";

    return {
        preview: (label) =>
            display === "diameter"
                ? { kind: "diameter", center: uvCenter, radius, position: label }
                : { kind: "radius", center: uvCenter, radius, position: label },
        resolve: (label): ResolvedDimension => ({
            constraint: {
                kind: ConstraintKind.Radius,
                refs: [center],
                datum: radius,
                ...(display === "diameter" ? { display } : {}),
            },
            anchor: { kind: "vector", dx: label[0] - uvCenter[0], dy: label[1] - uvCenter[1] },
            initial: display === "diameter" ? radius * 2 : radius,
            positiveOnly: !datumIsSigned(ConstraintKind.Radius),
        }),
    };
}

/** The axis a two-point reading measures along; undefined for the aligned one. */
function twoPointAxis(mode: TwoPointMode): "h" | "v" | undefined {
    if (mode === "aligned") return undefined;
    return mode === "horizontal" ? "h" : "v";
}

/**
 * How two points read in one mode: the constraint that holds the reading, what it measures,
 * and the frame its dimension line is drawn in. Δx and Δy differ by nothing but the axis, so
 * they are one branch; the aligned reading — the two points' true separation — stands alone.
 *
 * An axis reading's datum is signed because garlic's is: `second − first` along the axis, so the
 * sign says which point is to the right (or above) the other, and which one that is follows the
 * order the two were picked in. Nothing in the UI shows it — the dimension reads the magnitude
 * (`datumSignIsSide`).
 */
function twoPointReading(
    mode: TwoPointMode,
    first: Point2,
    second: Point2,
    label: Point2,
): { kind: ConstraintKind; datum: number; label: DimensionLabel } {
    const axis = twoPointAxis(mode);
    if (axis === undefined) {
        return {
            kind: ConstraintKind.P2PDistance,
            datum: Math.hypot(second[0] - first[0], second[1] - first[1]),
            label: labelOnSegment(first, second, label),
        };
    }
    const index = axis === "h" ? 0 : 1;
    return {
        kind: axis === "h" ? ConstraintKind.HorizontalDistance : ConstraintKind.VerticalDistance,
        datum: second[index] - first[index],
        label: labelOnAxis(first, second, axis, label),
    };
}

/** Two points: the reading follows the label, exactly as `classifyTwoPoint` decides it. */
function buildTwoPoint(
    solver: SketchSolver,
    first: SketchPointRef,
    second: SketchPointRef,
): DimensionPlan | undefined {
    const uvFirst = solver.pointOf(first);
    const uvSecond = solver.pointOf(second);
    if (Math.hypot(uvSecond[0] - uvFirst[0], uvSecond[1] - uvFirst[1]) < 1e-9) return undefined;

    return {
        preview: (label) => {
            const axis = twoPointAxis(classifyTwoPoint(uvFirst, uvSecond, label) ?? "aligned");
            return axis === undefined
                ? { kind: "distance", p1: uvFirst, p2: uvSecond, position: label }
                : { kind: "axisDistance", p1: uvFirst, p2: uvSecond, axis, position: label };
        },
        resolve: (label) => {
            const mode = classifyTwoPoint(uvFirst, uvSecond, label) ?? "aligned";
            return resolveTwoPoint(solver, first, second, uvFirst, uvSecond, mode, label);
        },
    };
}

function resolveTwoPoint(
    solver: SketchSolver,
    first: SketchPointRef,
    second: SketchPointRef,
    uvFirst: Point2,
    uvSecond: Point2,
    mode: TwoPointMode,
    label: Point2,
): ResolvedDimension {
    const reading = twoPointReading(mode, uvFirst, uvSecond, label);
    const aligned = reading.kind === ConstraintKind.P2PDistance;
    return {
        constraint: {
            kind: reading.kind,
            // the picked refs may belong to neighbours the corners are shared with, and only
            // the aligned reading spans a line — so only it has something to normalize onto
            refs: aligned ? [...normalizeLineRefs(solver, first, second)] : [first, second],
            datum: reading.datum,
        },
        anchor: { kind: "offset", ...reading.label },
        // an axis reading's datum is signed — which of the two points is to the right of the
        // other — and the dialog opens on the magnitude like the dimension reads (`toDisplayDatum`)
        initial: Math.abs(reading.datum),
        // the same rule as everywhere else, read off the reading instead of the kind: the label
        // chose which one this is, and only the aligned one has no side to flip (`datumSignIsSide`)
        positiveOnly: aligned,
    };
}

/**
 * A point's perpendicular distance to a line — the one reading both "a point and a line" and
 * "two parallel lines" come down to. They differ only in where the point comes from, so it
 * arrives as a function of the label: fixed for the first, and for the second the first line's
 * endpoint nearest the label, so the leader reaches out of the side the user placed the
 * dimension on.
 */
function pointToLinePlan(
    solver: SketchSolver,
    pointOf: (label: [number, number]) => SketchPointRef,
    lineId: number,
): DimensionPlan {
    const lineStart: SketchPointRef = { entityId: lineId, pointIndex: 0 };
    const lineEnd: SketchPointRef = { entityId: lineId, pointIndex: 1 };
    const uvStart = solver.pointOf(lineStart);
    const uvEnd = solver.pointOf(lineEnd);

    return {
        preview: (label) => ({
            kind: "pointLine",
            p: solver.pointOf(pointOf(label)),
            l1: uvStart,
            l2: uvEnd,
            position: label,
        }),
        resolve: (label) => {
            const point = pointOf(label);
            const uvPoint = solver.pointOf(point);
            const { datum, reading } = pointLineReading(uvPoint, uvStart, uvEnd);
            const foot = pointLineFoot(uvPoint, uvStart, uvEnd) ?? uvStart;
            return {
                constraint: {
                    kind: ConstraintKind.P2LDistance,
                    refs: [point, lineStart, lineEnd],
                    datum,
                },
                anchor: { kind: "offset", ...labelOnSegment(uvPoint, foot, label) },
                initial: reading,
                positiveOnly: !datumIsSigned(ConstraintKind.P2LDistance),
            };
        },
    };
}

/** A point's perpendicular distance to a line. */
function buildPointLineDistance(solver: SketchSolver, point: SketchPointRef, lineId: number): DimensionPlan {
    return pointToLinePlan(solver, () => point, lineId);
}

/**
 * The gap between two parallel lines, read as the distance from one line's endpoint to the
 * other line. garlic has no line-to-line distance, and two arbitrary endpoints would
 * measure a slant rather than a gap; a point-to-line distance IS the perpendicular gap,
 * and on parallel lines it is the same from anywhere along the first one.
 */
function buildLineGap(solver: SketchSolver, firstId: number, secondId: number): DimensionPlan {
    /** The endpoint of the first line on the side the label was placed. */
    const nearEnd = (label: [number, number]): SketchPointRef => {
        const start = solver.pointOf({ entityId: firstId, pointIndex: 0 });
        const end = solver.pointOf({ entityId: firstId, pointIndex: 1 });
        const toStart = Math.hypot(label[0] - start[0], label[1] - start[1]);
        const toEnd = Math.hypot(label[0] - end[0], label[1] - end[1]);
        return { entityId: firstId, pointIndex: toStart <= toEnd ? 0 : 1 };
    };
    return pointToLinePlan(solver, nearEnd, secondId);
}

/** The angle between two lines, measured the way the label's sector asks for. */
function buildAngle(solver: SketchSolver, firstId: number, secondId: number): DimensionPlan {
    const refs: SketchPointRef[] = [
        { entityId: firstId, pointIndex: 0 },
        { entityId: firstId, pointIndex: 1 },
        { entityId: secondId, pointIndex: 0 },
        { entityId: secondId, pointIndex: 1 },
    ];
    const [a1, a2, b1, b2] = refs.map((ref) => solver.pointOf(ref));

    return {
        preview: (label) => ({ kind: "angle", a1, a2, b1, b2, position: label }),
        resolve: (label) => {
            // reversing the second line's refs is what stores the label's choice between
            // the angle and its supplement — the same rule the dedicated angle command uses
            const measured = measureAngleBetween(refs, [a1, a2, b1, b2], label);
            return {
                constraint: {
                    kind: ConstraintKind.Angle,
                    refs: measured.refs,
                    datum: measured.datum,
                },
                anchor: {
                    kind: "vector",
                    dx: label[0] - measured.vertex[0],
                    dy: label[1] - measured.vertex[1],
                },
                initial: toDisplayDatum(ConstraintKind.Angle, measured.datum),
                positiveOnly: !datumIsSigned(ConstraintKind.Angle),
            };
        },
    };
}

/** The distance between two round entities' centers. */
function buildCenterDistance(first: SketchEntityData, second: SketchEntityData): DimensionPlan | undefined {
    const firstCenter: SketchPointRef = { entityId: first.id, pointIndex: 0 };
    const secondCenter: SketchPointRef = { entityId: second.id, pointIndex: 0 };
    const uvFirst: [number, number] = [first.params[0], first.params[1]];
    const uvSecond: [number, number] = [second.params[0], second.params[1]];
    const distance = Math.hypot(uvSecond[0] - uvFirst[0], uvSecond[1] - uvFirst[1]);
    if (distance < 1e-9) return undefined;

    return {
        preview: (label) => ({ kind: "distance", p1: uvFirst, p2: uvSecond, position: label }),
        resolve: (label) => ({
            constraint: {
                kind: ConstraintKind.P2PDistance,
                refs: [firstCenter, secondCenter],
                datum: distance,
            },
            anchor: { kind: "offset", ...labelOnSegment(uvFirst, uvSecond, label) },
            initial: distance,
            positiveOnly: !datumIsSigned(ConstraintKind.P2PDistance),
        }),
    };
}

/**
 * The angle a placement asks for: the refs to store it with, its signed datum, and the
 * vertex its label hangs off. Duplicated in spirit from the dedicated angle command —
 * that one measures before it has a label and re-measures after, so the two cannot share
 * a body without one of them carrying the other's state.
 */
function measureAngleBetween(
    refs: readonly SketchPointRef[],
    points: readonly [number, number][],
    label: [number, number],
): { refs: SketchPointRef[]; vertex: [number, number]; datum: number } {
    const [a1, a2, b1, b2] = points;
    const vertex = angleVertex(a1, a2, b1, b2);
    const d1: [number, number] = [a2[0] - a1[0], a2[1] - a1[1]];
    const d2: [number, number] = [b2[0] - b1[0], b2[1] - b1[1]];
    const supplement = measuresSupplement(d1, d2, [label[0] - vertex[0], label[1] - vertex[1]]);
    return {
        refs: supplement ? [refs[0], refs[1], refs[3], refs[2]] : [...refs],
        vertex,
        datum: signedSweep(d1, supplement ? [-d2[0], -d2[1]] : d2),
    };
}

/** Whether the two lines run parallel — the sine of their angle, so it is scale free. */
function areParallel(solver: SketchSolver, firstId: number, secondId: number): boolean {
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

/** ≈0.057° — the same scale-free flavour of tolerance the solver's own degeneracy checks use. */
const PARALLEL_SINE_TOLERANCE = 1e-3;

function normalize(v: [number, number]): [number, number] | undefined {
    const length = Math.hypot(v[0], v[1]);
    return length < 1e-12 ? undefined : [v[0] / length, v[1] / length];
}

/** Whether a point sits on a line — itself, or through a coincidence with one of its points. */
function liesOnLine(solver: SketchSolver, point: SketchPointRef, lineId: number): boolean {
    if (point.entityId === lineId) return true;
    return solver.coincidentGroup(point).some((ref) => ref.entityId === lineId);
}
