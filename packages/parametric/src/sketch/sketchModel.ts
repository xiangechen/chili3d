// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type DimensionLabel,
    type IView,
    LENGTH_UNITS,
    type ParameterValue,
    Plane,
    Precision,
    Result,
    resolveUnitSpec,
    type Scope,
    UNITLESS,
    type UnitSpec,
    VisualConfig,
    XYZ,
} from "@chili3d/core";
import { ConstraintKind } from "../../lib/garlic";
import type { EdgeRef } from "../features/edgeRef";

export { ConstraintKind };

/** Screen-pixel line width of sketch geometry (entity edges, in and out of the editor). */
export const SKETCH_EDGE_LINE_WIDTH = 2;

export type SketchEntityType =
    | "line"
    | "circle"
    | "arc"
    | "ellipse"
    | "ellipseArc"
    | "conic"
    | "bezier"
    | "nurbs"
    | "offsetCurve";

/**
 * line: params = [x1, y1, x2, y2]; circle: params = [cx, cy, r];
 * arc: params = [cx, cy, sx, sy, ex, ey] (center, start, end; radius = ‖s−c‖,
 * counter-clockwise sweep from start to end);
 * ellipse: params = [cx, cy, mx, my, nx, ny] (center, major-axis point, minor-axis
 * point — garlic reads the two axis points as perpendicular, which the entity's
 * structural Perpendicular constraint keeps true);
 * ellipseArc: the ellipse layout plus [sx, sy, ex, ey] (start, end; both pinned on the
 * ellipse by structural PointOnEllipse constraints, counter-clockwise sweep of the
 * ellipse parameter from start to end);
 * conic: params = [sx, sy, cx, cy, ex, ey, rho] (start, control, end, and the shoulder
 * ratio ρ ∈ (0, 1): a rational quadratic bezier with weights [1, ρ/(1−ρ), 1]);
 * bezier: params = [cp0x, cp0y, …, cp3x, cp3y] (the four control poles of a cubic);
 * nurbs: params = [cp0x, cp0y, …, cp_{n−1}x, cp_{n−1}y, w0, …, w_{n−1}] (n control
 * poles followed by their rational weights, with the degree and knot vector in
 * `nurbs`);
 * offsetCurve: params are its *source's*, verbatim, and `offset` says which entity they
 * came from and how far off it this curve runs — the entity has no geometry of its own to
 * lay out, so nothing of it is a solver parameter at all — all in sketch (u, v) coordinates.
 */
export interface SketchEntityData {
    id: number;
    type: SketchEntityType;
    params: number[];
    /**
     * A NURBS' construction constants (see `NurbsSpec`). They ride on the entity rather
     * than in `params` because garlic takes them as a separate argument to
     * `add_constraint` — they are not solver parameters, so they are not params at all:
     * the control points and weights beside them are. Present on a nurbs entity only.
     */
    nurbs?: NurbsSpec;
    /**
     * What an `offsetCurve` is the offset *of*: the entity whose geometry it carries in
     * `params`, the kind those params lay out (`params` alone cannot say — an offset of a
     * circle and an offset of a line are laid out differently), and the distance.
     *
     * The source's kind rides here rather than being looked up because the curve math reads
     * an entity on its own — no solver, no other entity — and an offset curve has to be
     * readable the same way. Its own kind is `offsetCurve`; this is the kind underneath.
     */
    offset?: OffsetCurveRef;

    /**
     * Construction geometry: a constraint/snap/drag target like any other entity,
     * but excluded from the shape and therefore from profile building — the
     * native-entity counterpart of a "reference"-role external ref. Emitted only
     * when true, so documents without construction geometry round-trip unchanged.
     */
    construction?: boolean;
}

/**
 * A NURBS curve's construction constants: the degree and the *flat* knot vector (one
 * entry per index, repeats and all, length = poles + degree + 1). garlic's own name for
 * the pair, and the shape its `add_constraint` takes them in; the sketch's default
 * construction is the clamped uniform one (`clampedUniformKnots`), which is what every
 * CAD sketch tool offers and all the user ever gets.
 */
export interface NurbsSpec {
    degree: number;
    knots: number[];
}

/**
 * What an `offsetCurve` runs parallel to. The distance is in sketch units and signed by the
 * source's own reading of "one side" (see `offsetOps`): a claim about the *pair*, so it is
 * kept with the pair rather than in the offset's own params — which are the source's.
 */
export interface OffsetCurveRef {
    /** The entity whose geometry this curve carries, and which it follows as it changes. */
    sourceId: number;
    /** How that entity's params lay out — the array of positions this curve sits off. */
    sourceType: Exclude<SketchEntityType, "offsetCurve">;
    distance: number;
    /**
     * The stretch of the source this copy runs over, when it has been trimmed — absent is the
     * whole of it. A window rather than new geometry: an offset curve is only the parallel
     * curve of what it reads, so cutting it is cutting the source's range, and the copy stays
     * exact — and stays following its source — afterwards.
     *
     * Both numbers are in the **source's own parameter** — the absolute angle for the ellipse
     * families, the knots for a NURBS, [0, 1] for a bezier or conic. That is what keeps a
     * copy's ends exact: nothing can pin them (a copy has no point of its own), so the window
     * is the whole of where they are, and a length read off a polyline would bake its own
     * error in. On a periodic source (the ellipse) the second may run past the first by up to
     * a turn, which is how a piece straddling the source's seam is named; on any other it
     * cannot, and a window is clamped into the source it has.
     *
     * It can only be a window *of the source*: off the ends of the source there is no parallel
     * curve at all, which is why extending a copy past its source's end extends the source.
     */
    window?: [number, number];
}

/**
 * The degree the sketch gives a NURBS of `poleCount` control poles: cubic, or one less
 * than the pole count when there are not enough poles to be cubic (garlic's own bound is
 * degree ≤ poles − 1). Two poles come out degree 1 — a straight line, which is what the
 * tool draws before the third pick — and a lone pole degree 0, which is not a curve at all:
 * that is what a tool's first pick is before the probe reaches its second, and what keeps
 * the knot vector the evaluation reads consistent with the poles it has.
 */
export function defaultNurbsDegree(poleCount: number): number {
    // floored: a malformed entity reads as a *fraction* of a pole when its params are not
    // three per pole (`nurbsPoleCount`), and a fractional degree is not a curve — it is
    // `new Array(degree + 1)` throwing out of a rebuild
    return Math.max(0, Math.min(3, Math.floor(poleCount) - 1));
}

/**
 * A NURBS' params from its control points alone: control points, then one weight each — the
 * layout the entity stores (`SketchEntityData`). A tool drawing the curve it is still picking
 * has the points and nothing else to give, and the entity it commits carries the unit weights
 * this fills in. Point pairs *without* the weights are not a layout the evaluation can read
 * (three params per pole is), which is how a spline being drawn came to be read as a curve of
 * a fractional degree.
 */
export function nurbsParams(poles: readonly number[]): number[] {
    return [...poles, ...new Array<number>(Math.floor(poles.length / 2)).fill(1)];
}

/**
 * garlic's clamped uniform knot vector (`nurbs.rs::clamped_uniform`), n = `poleCount`:
 * the first and last knots carry multiplicity degree + 1, so the curve is clamped at both
 * ends, and the interior knots are the integers between them. The curve's domain is
 * [knots[degree], knots[poleCount]] — which is what `curveEval` reads.
 */
export function clampedUniformKnots(poleCount: number, degree: number): number[] {
    const knots = new Array<number>(degree + 1).fill(0);
    for (let i = 1; i < poleCount - degree; i++) knots.push(i);
    for (let i = 0; i <= degree; i++) knots.push(poleCount - degree);
    return knots;
}

/** The NurbsSpec a sketch NURBS of `poleCount` control poles is built with. */
export function defaultNurbsSpec(poleCount: number): NurbsSpec {
    const degree = defaultNurbsDegree(poleCount);
    return { degree, knots: clampedUniformKnots(poleCount, degree) };
}

/**
 * line: pointIndex 0 = start, 1 = end; circle: pointIndex 0 = center;
 * arc: pointIndex 0 = center, 1 = start, 2 = end;
 * ellipse: pointIndex 0 = center, 1 = major-axis point, 2 = minor-axis point;
 * ellipseArc: the ellipse's 0–2, then 3 = start, 4 = end;
 * conic: pointIndex 0 = start, 1 = control, 2 = end (rho is a scalar, not a point);
 * bezier: pointIndex i = the i-th control pole (all four are points);
 * nurbs: pointIndex i = the i-th control pole — its weights are params too, but they are
 * not addressed as points and have no index here.
 */
export interface SketchPointRef {
    entityId: number;
    pointIndex: number;
}

/** Addressable points per fixed-size entity type; a nurbs' count follows its pole count. */
const ENTITY_POINT_COUNTS: Record<Exclude<SketchEntityType, "nurbs">, number> = {
    // an offset curve has no point of its own: it is its source's geometry, moved
    offsetCurve: 0,
    circle: 1,
    line: 2,
    arc: 3,
    ellipse: 3,
    ellipseArc: 5,
    conic: 3,
    bezier: 4,
};

/** Number of point refs an entity exposes (`pointIndex` runs 0..n−1). */
export function entityPointCount(entity: Pick<SketchEntityData, "type" | "params">): number {
    // a nurbs holds three params per pole — the pole's two coordinates and its weight — and a
    // params list that is not a whole number of them floors, the way `curveEval.nurbsPoleCount`
    // does: the two must agree, or a foreign or hand-edited list reads as a fraction of a pole
    if (entity.type === "nurbs") return Math.floor(entity.params.length / 3);
    return ENTITY_POINT_COUNTS[entity.type];
}

export interface SketchConstraintData {
    id: number;
    kind: ConstraintKind;
    refs: SketchPointRef[];
    /**
     * A literal in solver-storage units, or an expression written in display units
     * that resolves against the document's parameters (`resolveDatumSource`).
     *
     * A side-carrying distance's sign is a side marker rather than part of the value: the
     * dimension reads the magnitude, and the solver keeps the sign on the side the geometry is
     * on (`datumSignIsSide`, `SketchSolver.sideSignedDatum`).
     */
    datum?: ParameterValue;
    /** Datum values for multi-datum kinds (Fix = [x, y]); mutually exclusive with `datum`. */
    datums?: ParameterValue[];
    /**
     * How a radius datum reads: `radius` (absent) or `diameter`. Rides on the constraint
     * rather than on the label anchor because the *solver* is what has to apply the
     * conversion — garlic has no diameter constraint, so the reading is twice the datum
     * it drives, and only this record knows which reading the user wrote.
     */
    display?: RadiusDisplay;
    /**
     * A driven (reference) dimension: it measures the geometry and never constrains it,
     * the way SolidWorks' reference dimensions and FreeCAD's reference constraints do.
     * garlic has the mode natively — a driven constraint contributes no degree of freedom
     * and has its datum *written back* after each solve, which is precisely "the geometry
     * drives the dimension"; `SketchSolver` is what passes the flag through. Absent is
     * driving, so a reference from before this existed round-trips unchanged.
     *
     * Only a dimensional constraint can be driven: garlic refuses `driving = false`
     * without a datum, and there is nothing for a geometric one to measure.
     */
    driven?: boolean;
}

/**
 * Structural constraints are part of the entity, not user constraints — they get no
 * badge and no row in the constraint list, and deleting one would break the entity's
 * geometry. They are: the arc's PointOnArc (keeps the end on the circle of center +
 * start); the ellipseArc's PointOnEllipse (same, for start and end on the ellipse);
 * the ellipse family's Perpendicular (keeps the minor-axis point perpendicular to the
 * major axis — garlic reads the two axis points as perpendicular, so without it the
 * solved curve and the drawn one would diverge). All of them reference their own
 * entity alone; the Perpendicular case is told from a same-line user pick by its
 * ref pattern [c, m, c, n] — two different points either side of the repeated center.
 */
export function isStructuralConstraint(constraint: SketchConstraintData): boolean {
    const selfReferential = constraint.refs.every((r) => r.entityId === constraint.refs[0].entityId);
    if (!selfReferential) return false;
    if (constraint.kind === ConstraintKind.PointOnArc || constraint.kind === ConstraintKind.PointOnEllipse) {
        return true;
    }
    return (
        constraint.kind === ConstraintKind.Perpendicular &&
        constraint.refs.length === 4 &&
        constraint.refs[0].pointIndex === constraint.refs[2].pointIndex &&
        constraint.refs[1].pointIndex !== constraint.refs[3].pointIndex
    );
}

/**
 * The unit a dimension of `kind` measures — what an expression driving it must
 * resolve to, and what `toDatumSource`/`resolveDatumSource` convert between.
 */
export function datumUnitSpec(kind: ConstraintKind): UnitSpec {
    if (kind === ConstraintKind.Angle) return ANGLE_UNITS;
    // rho is a ratio — it converts through no unit at all
    if (kind === ConstraintKind.ConicRho) return UNITLESS;
    return LENGTH_UNITS;
}

/**
 * The kinds whose datum carries a *side* rather than a value: which side of the line the point
 * sits on, or which way along the axis the second point is from the first. The dimension reads as
 * the magnitude either way — Onshape's own rule, drawn in its help page as the label staying
 * positive while the input box holds the minus, and written down by SolveSpace as "always shown
 * positive on the sketch; to flip to the other side, enter a negative value".
 *
 * The sign is the solver's, not the user's: `SketchSolver` keeps it attached across edits
 * (`sideSignedDatum`), the way `syncAngleDatumSide` keeps an angle's.
 */
export function datumSignIsSide(kind: ConstraintKind): boolean {
    return (
        kind === ConstraintKind.P2LDistance ||
        kind === ConstraintKind.HorizontalDistance ||
        kind === ConstraintKind.VerticalDistance
    );
}

/**
 * Whether the datum dialogs let a minus through. A side-carrying distance takes one as the flip
 * gesture (`datumSignIsSide`), and a pinned point's coordinates are signed because the sign *is*
 * the value; nothing else has a sign to give. A length, an angle or a radius is a magnitude and
 * can only be one. The datum dialogs ask this to decide whether to refuse a minus sign
 * (`positiveOnly` in `datumPrompt`), so it lives beside `datumUnitSpec` — the other thing about a
 * kind that the editor and the tools both have to agree on, rather than each writing the set of
 * kinds out for itself.
 */
export function datumIsSigned(kind: ConstraintKind): boolean {
    return datumSignIsSide(kind) || kind === ConstraintKind.Fix;
}

/**
 * Whether `kind`'s datum is a *reading* — the number a dimension measures — rather than a pinned
 * point's coordinates. A Fix is the one kind on the other side of that line, and it needs saying:
 * it keeps its coordinates in `datums`, exactly the way a dimension keeps its reading, so every
 * structural test for "has a datum" passes it and garlic accepts it as a reference without
 * complaint — while there is nothing for a reference to measure, and taking it as one does not
 * measure the point but *free* it, silently (the pin's two degrees of freedom come back). Both
 * places that decide whether a constraint may be driven ask this rather than those structural
 * tests, so the rule is written once.
 */
export function datumIsReading(kind: ConstraintKind): boolean {
    return kind !== ConstraintKind.Fix;
}

/**
 * Datum value shown in the UI: angles store the signed sweep (the sign picks the
 * side of the first line) and display its magnitude in degrees, a side-carrying
 * distance displays its magnitude too — the sign is which side, and the drawing
 * already says that (`datumSignIsSide`) — and a diameter reads as twice the radius
 * garlic holds. Everything else as stored.
 */
export function toDisplayDatum(
    kind: ConstraintKind,
    value: number,
    display: RadiusDisplay = "radius",
): number {
    if (kind === ConstraintKind.Angle) return (Math.abs(value) * 180) / Math.PI;
    if (datumSignIsSide(kind)) return Math.abs(value);
    if (kind === ConstraintKind.Radius && display === "diameter") return value * 2;
    return value;
}

/**
 * Datum value for the solver, from the magnitude the user gave. Angles store radians
 * (the solver re-attaches the side sign before solving — `SketchSolver.syncAngleDatumSide`)
 * and a diameter half the reading, since the constraint underneath is the radius. A
 * side-carrying distance is the magnitude as typed: the sign is the side the dimension
 * already sits on, which the solver attaches (`SketchSolver.sideSignedDatum`) rather than a
 * conversion with no geometry to read guessing at it.
 */
export function toStorageDatum(
    kind: ConstraintKind,
    value: number,
    display: RadiusDisplay = "radius",
): number {
    if (kind === ConstraintKind.Angle) return (value * Math.PI) / 180;
    if (kind === ConstraintKind.Radius && display === "diameter") return value / 2;
    return value;
}

/**
 * The user's input as stored: a literal is converted into storage units right away,
 * an expression is kept verbatim — it is written in display units, and converting it
 * before it resolves would mean re-parsing the conversion on every rebuild.
 */
export function toDatumSource(
    kind: ConstraintKind,
    input: ParameterValue,
    display: RadiusDisplay = "radius",
): ParameterValue {
    return typeof input === "number" ? toStorageDatum(kind, input, display) : input;
}

/**
 * A stored datum as the number the solver takes: a literal is already in storage
 * units, an expression resolves against `scope` (in display units, checked against
 * the kind's unit) and is converted afterwards. The conversion is the same one the
 * literal path takes, so an expression and a literal of the same reading agree.
 */
export function resolveDatumSource(
    kind: ConstraintKind,
    source: ParameterValue,
    scope: Scope,
    display: RadiusDisplay = "radius",
): Result<number> {
    if (typeof source === "number") return Result.ok(source);
    const resolved = resolveUnitSpec(source, scope, datumUnitSpec(kind));
    if (!resolved.isOk) return Result.err(resolved.error);
    return Result.ok(toStorageDatum(kind, resolved.value, display));
}

// The label frame is the planar layout's own input, so it lives beside that layout in
// core; re-exported here because the anchors below are part of the persisted SketchData.
export type { DimensionLabel };

/**
 * How a radius reads: as the radius itself, or as the diameter (Ø) over the same datum.
 * The solver has no diameter constraint — a diameter is a *reading* of a radius, so the
 * stored datum stays r and only what the user sees and types is doubled.
 */
export type RadiusDisplay = "radius" | "diameter";

/**
 * Label vector from the circle center (Radius) or the angle vertex (Angle). Where the
 * label sits is all the anchor holds: how the datum *reads* is the constraint's own
 * (`SketchConstraintData.display`), so dragging the label cannot turn a Ø back into an R.
 */
export type DimensionAnchor =
    /** A label in the measured line's frame — the linear distance kinds. */
    | ({ readonly kind: "offset" } & DimensionLabel)
    | { readonly kind: "vector"; readonly dx: number; readonly dy: number };

/** The reading a radius constraint asks for; anything but an explicit `diameter` is a radius. */
export function radiusDisplayOf(constraint: SketchConstraintData | undefined): RadiusDisplay {
    if (constraint?.kind !== ConstraintKind.Radius) return "radius";
    return constraint.display ?? "radius";
}

/** Datum label anchor bound to a constraint id (ids are stable across sessions). */
export interface SketchDimensionAnchor {
    id: number;
    anchor: DimensionAnchor;
}

/**
 * An edge of another node projected onto the sketch plane as construction
 * geometry. The edge is re-matched on the source node's current shape via the
 * stored `EdgeRef` fingerprint (exact `edgeId` hit when the source tracks
 * edges); the last successfully resolved geometry is kept in `snapshot` (sketch
 * UV params in the layout of `type`), so constraints keep solving against stale
 * geometry when resolution fails (`dangling`). Constraints reference external
 * entities as ordinary `{ entityId, pointIndex }` refs — no format change.
 */
export interface ExternalRefData {
    /** Reserved negative id, allocated from `FIRST_EXTERNAL_ENTITY_ID` downward. */
    entityId: number;
    /** Source node (the part) the edge lives on. */
    nodeId: string;
    /** Edge fingerprint, with the kernel edgeId when the source provides one. */
    edge: EdgeRef;
    /** "profile" externals join profile building; "reference" ones never do. */
    role: "reference" | "profile";
    /**
     * Set by an explicit profile-role choice: the profile role option when
     * projecting edges, and every `sketch.toggleExternal` flip. Auto-derivation
     * never overrides a pinned ref (see `syncExternalRoles`). An explicit REFERENCE
     * pick (the default role option) stays unpinned — a promotable default: when a
     * constraint later references the edge, derivation promotes it to profile.
     * That is deliberate: reference-role edges never enter `generateShape`, so
     * promotion is the only way a referenced edge can close loops into faces.
     */
    pinned?: boolean;
    /** Last resolved params in sketch UV (line/circle/arc layout matching `type`). */
    snapshot: number[];
    /** Resolved sketch entity type. */
    type: SketchEntityType;
    /** Resolution failed at the last rebuild; `snapshot` is stale (but still builds profiles). */
    dangling?: boolean;
}

export type SketchArrayType = "linear" | "circular" | "curve";

/** How far one direction of a linear array steps, and how many it lays down. */
export interface SketchArrayAxis {
    /** Instances along this direction, the seed included; 1 lays down none. */
    readonly count: number;
    readonly spacing: ParameterValue;
}

/**
 * Where a circular array turns. A point of the sketch when the user put it on geometry — it
 * then follows that geometry the way a dimension follows what it measures — and a pair of
 * coordinates when they put it on empty space. That is Onshape's own pair: pick a reference,
 * or place a point.
 */
export type SketchArrayCenter =
    | { readonly type: "ref"; readonly ref: SketchPointRef }
    | { readonly type: "at"; readonly u: number; readonly v: number };

/**
 * How an array lays its instances out. Every reference is a *live* one — a point of a
 * real entity, or the origin and the X/Y datum axes — so the instances follow whatever
 * the referenced geometry does, exactly as a dimension follows the entity it measures.
 *
 * `spacing` and `twist` are `ParameterValue`s in display units (lengths in model units,
 * angles in degrees), resolved against the document's parameters by the solver's scope;
 * a literal is converted to solver storage units on the way in, an expression is kept as
 * written so `setScope` can re-resolve it — the same bargain a constraint datum makes
 * (`toDatumSource` / `resolveDatumSource`).
 *
 * Each pattern carries its own counts, and there is no count on the record beside them: a
 * linear pattern's two directions mean two numbers, and a total stored next to them would be
 * a second answer to the same question. `arrayInstanceTotal` is how the total is read.
 */
export type SketchArrayPattern =
    /**
     * Along the sketch's own two axes — the grid every pattern starts from. Each direction
     * has its own count and spacing, and a count of 1 means that direction lays down nothing
     * (which is how a single-direction pattern reads). A negative spacing runs the other way.
     */
    | { readonly type: "linear"; readonly x: SketchArrayAxis; readonly y: SketchArrayAxis }
    /**
     * Around `center` through `twist` — the total turn, counter-clockwise. `equalSpacing`
     * divides it by the count so the last instance lands back on the first (a full turn
     * spread over N); without it the turn is divided over N−1 steps and the last instance
     * lands exactly on `twist`.
     */
    | {
          readonly type: "circular";
          readonly center: SketchArrayCenter;
          readonly count: number;
          readonly twist: ParameterValue;
          readonly equalSpacing: boolean;
      }
    /** Along `curveId`, placed every `spacing` and turned to the curve's tangent there. */
    | {
          readonly type: "curve";
          readonly curveId: number;
          readonly count: number;
          readonly spacing: ParameterValue;
      };

/**
 * A pattern of sketch entities, held as a *definition* rather than as its result: the
 * instances are ordinary entities the solver derives on every solve (`SketchSolver`'s
 * `refreshArrays`), so editing the seed, the reference or a parameter moves the whole
 * pattern, and a re-opened sketch rebuilds it from this record alone.
 *
 * garlic has no pattern (and no directed-distance) constraint, so there is nothing that
 * could tie an instance to its seed the way a mirror ties its copy by symmetry — the
 * record *is* the tie. That is also why instances are read-only: their params are
 * written back from here on every solve, so a drag or a dimension on one would be
 * overwritten.
 *
 * A single instance *can* be taken out of the pattern, by deleting it (`null` in
 * `instanceEntityIds`): the count is then still the count, and the hole stays a hole —
 * raising it later adds new instances after the last one rather than filling it in. That is
 * Onshape's own rule for a deleted sketch-pattern occurrence, and it is what keeps the
 * count meaning what the tool says it means.
 */
export interface SketchArrayData {
    id: number;
    /** The entities being patterned; the seed itself is instance 0 and is not duplicated. */
    sourceIds: number[];
    /** Everything about how the instances are laid out — the counts included. */
    pattern: SketchArrayPattern;
    /**
     * The generated instances' entity ids, one slot per (instance, source): instance-major,
     * sources in their own order. Ids come from the solver's monotonic allocator and are
     * never reused, which is what keeps a `ProfileRef` fingerprint over a patterned region
     * stable across sessions — and what keeps a slot paired with the same instance for good.
     *
     * A `null` slot is an instance the user took *out* of the pattern (see
     * `SketchArrayData`'s own note): the slot stays, so the instances after it keep their
     * ids. Removing the entry instead would slide every later id one slot back and quietly
     * re-point a region fingerprint at a different hole.
     */
    instanceEntityIds: (number | null)[];
}

export interface SketchData {
    entities: SketchEntityData[];
    constraints: SketchConstraintData[];
    /** Datum label positions chosen by the user; absent when never placed. */
    anchors?: SketchDimensionAnchor[];
    /** Edges of other nodes usable as constraint targets (and optionally profiles). */
    externalRefs?: ExternalRefData[];
    /**
     * Timeline anchor per referenced parametric body (nodeId → feature count when
     * the sketch first referenced it). The sketch editor rolls each such body back
     * to this position for the session (see `computeSketchRollback`), so the plane
     * and external references resolve against the geometry they were captured from
     * and features added later are hidden while editing. Recorded only at capture
     * time (sketch creation on a face, `sketch.projectEdges`), never on the
     * resolution/generateShape path.
     */
    refPositions?: Record<string, number>;
    /**
     * Next real entity id (monotonic, counts up from 1). Entity ids are the primary
     * key of ProfileRef region identity, so a freed id is never reused — a stale
     * fingerprint could otherwise match a geometrically different region. Absent in
     * documents written before the counters; the solver then initializes it from the
     * current max entity id + 1.
     */
    entityIdSeq?: number;
    /**
     * Next external entity id (monotonic, counts down from FIRST_EXTERNAL_ENTITY_ID).
     * Same no-reuse guarantee as `entityIdSeq`; absent in pre-counter documents,
     * where the solver initializes it from the current min external id − 1.
     */
    externalIdSeq?: number;
    /**
     * Next constraint id (monotonic, counts up from 1). Constraint ids key the
     * persisted dimension anchors, so they carry the same no-reuse guarantee as
     * `entityIdSeq`: a freed id inherited by a later constraint would drag that
     * constraint's label to the old one's anchor. Absent in pre-counter documents,
     * where the solver initializes it from the current max constraint id + 1.
     */
    constraintIdSeq?: number;
    /**
     * The sketch's arrays (`SketchArrayData`). Absent when the sketch has none — like the
     * id counters, it is emitted only once it means something, because a no-op session
     * must round-trip `dataJson` byte-identically or exiting a sketch would record a
     * phantom history entry.
     *
     * The instances themselves are ordinary entries of `entities`: they are geometry the
     * profile builder and the mesher must see like any other, and an arc instance carries
     * the same structural `PointOnArc` constraint (`addArc`) that has to round-trip by id.
     * This record is what says which of those entities are derived, and from what.
     */
    arrays?: SketchArrayData[];
}

export function emptySketchData(): SketchData {
    return { entities: [], constraints: [] };
}

/**
 * Derives unpinned external-ref roles from the constraints referencing them: a ref
 * any constraint (of any kind, dimensions included) points at is "profile", one no
 * constraint references is "reference". Refs with `pinned` keep their stored role —
 * an explicit user choice. Mutates in place; returns whether any role changed.
 * Applied when SketchData is finalized (solver `toData`, `loadData`), never on the
 * resolution/generateShape path.
 */
export function syncExternalRoles(data: Pick<SketchData, "constraints" | "externalRefs">): boolean {
    const refs = data.externalRefs;
    if (refs === undefined || refs.length === 0) return false;
    const referenced = new Set(data.constraints.flatMap((c) => c.refs.map((r) => r.entityId)));
    let changed = false;
    for (const ref of refs) {
        if (ref.pinned === true) continue;
        const role = referenced.has(ref.entityId) ? "profile" : "reference";
        if (ref.role !== role) {
            ref.role = role;
            changed = true;
        }
    }
    return changed;
}

/**
 * Reserved entity ids for the sketch datum: the origin point and the X/Y axis
 * lines. Real entity ids are allocated monotonically from 1 (`entityIdSeq` in the
 * solver, persisted as `SketchData.entityIdSeq`; constraint ids count up the same
 * way from `SketchData.constraintIdSeq`), so negatives never clash. Datum entities
 * live only in the solver — never serialized as entities, never rendered as sketch
 * geometry — but constraints may reference them and are serialized as ordinary
 * `SketchConstraintData`.
 */
export const SKETCH_ORIGIN_ID = -1;
export const SKETCH_X_AXIS_ID = -2;
export const SKETCH_Y_AXIS_ID = -3;

export function isDatumEntityId(id: number): boolean {
    return id === SKETCH_ORIGIN_ID || id === SKETCH_X_AXIS_ID || id === SKETCH_Y_AXIS_ID;
}

/**
 * Reserved entity ids for external references start at -100 and count down, so
 * they never collide with the datum ids (-1..-3) or real entity ids (1+). Ids are
 * allocated monotonically downward via `SketchData.externalIdSeq` and never
 * reused (a stale `ProfileRef` entity-id set must not hit a new, unrelated ref).
 * Like the datum, external entities live only in the solver (never serialized as
 * entities); their persistent state is `SketchData.externalRefs`.
 */
export const FIRST_EXTERNAL_ENTITY_ID = -100;

export function isExternalEntityId(id: number): boolean {
    return id <= FIRST_EXTERNAL_ENTITY_ID;
}

/**
 * External refs that participate in profile building: every profile-role ref,
 * including dangling ones — a ref whose source edge is (temporarily) gone keeps
 * contributing its last-known `snapshot`, so the sketch degrades to frozen
 * geometry (drawn red in the editor) instead of failing dependent features with
 * "not closed" errors. A later rebuild that re-matches the edge clears `dangling`
 * and the profile follows the freshened snapshot.
 */
export function profileExternalRefs(data: SketchData): ExternalRefData[] {
    return (data.externalRefs ?? []).filter((ref) => ref.role === "profile");
}

/**
 * The sketch's own entities that participate in profile building: every
 * non-construction entity. Construction entities stay constraint/snap targets in
 * the solver but never enter `generateShape`, so a region they help bound does
 * not close into a profile — the same rule reference-role external refs follow.
 */
export function profileEntities(data: SketchData): SketchEntityData[] {
    return data.entities.filter((entity) => entity.construction !== true);
}

/**
 * Entity ids parallel to the edges `SketchNode.generateShape` emits: the sketch's
 * own non-construction entities first, then the profile-role external refs.
 * `sketchProfiles` maps the kernel's source edge indexes through this list on the
 * crossing path.
 */
export function shapeEntityIds(data: SketchData): number[] {
    return [
        ...profileEntities(data).map((entity) => entity.id),
        ...profileExternalRefs(data).map((r) => r.entityId),
    ];
}

/**
 * The colour a sketch entity draws in while the sketch editor is open — its line and its
 * own point markers alike: the default edge colour once the constraints pin every one of
 * its parameters, the free colour until then. `pinned` is undefined outside a colouring
 * session, where nothing is pinned and so everything draws free.
 */
export function sketchConstraintColor(pinned: ReadonlySet<number> | undefined, entityId: number): number {
    return pinned?.has(entityId) ? VisualConfig.defaultEdgeColor : VisualConfig.sketchFreeColor;
}

/** Point ref of the sketch origin (0, 0). */
export function originRef(): SketchPointRef {
    return { entityId: SKETCH_ORIGIN_ID, pointIndex: 0 };
}

/** The two point refs addressing a datum axis as a line (pointIndex 0/1). */
export function axisLineRefs(axisId: number): [SketchPointRef, SketchPointRef] {
    return [
        { entityId: axisId, pointIndex: 0 },
        { entityId: axisId, pointIndex: 1 },
    ];
}

/** Fixed (u, v) coordinates of a datum point ref. */
export function datumPoint(ref: SketchPointRef): [number, number] {
    if (ref.entityId === SKETCH_ORIGIN_ID) return [0, 0];
    if (ref.entityId === SKETCH_X_AXIS_ID) return ref.pointIndex === 0 ? [0, 0] : [1, 0];
    if (ref.entityId === SKETCH_Y_AXIS_ID) return ref.pointIndex === 0 ? [0, 0] : [0, 1];
    throw new Error(`Not a datum entity: ${ref.entityId}`);
}

/** Synthetic entity data of a datum axis line, for meshes and type checks. */
export function datumEntityData(id: number): SketchEntityData {
    if (id === SKETCH_X_AXIS_ID) return { id, type: "line", params: [0, 0, 1, 0] };
    if (id === SKETCH_Y_AXIS_ID) return { id, type: "line", params: [0, 0, 0, 1] };
    throw new Error(`Not a datum axis: ${id}`);
}

/** Stable string key of a point ref, for grouping/dedup. */
export function pointRefKey(ref: SketchPointRef): string {
    return `${ref.entityId}:${ref.pointIndex}`;
}

export function cloneSketchData(data: SketchData): SketchData {
    return JSON.parse(JSON.stringify(data)) as SketchData;
}

/**
 * Raw counter-clockwise sweep of an arc entity's params [cx, cy, sx, sy, ex, ey],
 * un-normalized, in (−2π, 2π): zero when start and end share a ray, negative when
 * the end ray sits clockwise of the start ray (a near-full-circle arc).
 * `arcAngles` normalizes this into (0, 2π].
 */
export function rawArcSweep(params: number[]): number {
    const [cx, cy, sx, sy, ex, ey] = params;
    return (Math.atan2(ey - cy, ex - cx) - Math.atan2(sy - cy, sx - cx)) % (Math.PI * 2);
}

/**
 * Start angle and counter-clockwise sweep (normalized to (0, 2π]) of an arc
 * entity's params [cx, cy, sx, sy, ex, ey]; the end point only fixes the angle,
 * the radius is always ‖s−c‖.
 */
export function arcAngles(params: number[]): [number, number] {
    const [cx, cy, sx, sy] = params;
    const a0 = Math.atan2(sy - cy, sx - cx);
    const sweep = rawArcSweep(params);
    return [a0, sweep > Precision.Angle ? sweep : sweep + Math.PI * 2];
}

/** Radius of a circle (params[2]) or arc (‖start−center‖) entity. */
export function entityRadius(entity: SketchEntityData): number {
    if (entity.type === "circle") return entity.params[2];
    if (entity.type === "arc") {
        return Math.hypot(entity.params[2] - entity.params[0], entity.params[3] - entity.params[1]);
    }
    throw new Error(`Entity ${entity.id} has no radius`);
}

/**
 * Whether two param layouts of the same type describe the same geometry.
 *
 * The line is the awkward one: its params are not ordered, so a line reflected or
 * offset into the opposite direction comes back with its endpoints swapped and reads
 * as a different line until they are compared as a pair. An arc's are ordered — the
 * sweep is directed — so they must match in place; a circle's radius counts as much
 * as its center. An ellipse reads the same however its frame is signed or swapped —
 * (c, u, v) and (c, −u, v) are one curve — the conic and the cubic bezier read the
 * same taken in reverse, which is what a reflection across the curve's own axis of
 * symmetry lands on, and a nurbs does not: its knot vector is what fixes which way
 * round the curve runs, so a reversed one is a genuinely different entity.
 *
 * The mirror uses it to leave out a copy that is already in the sketch, and the
 * offset to refuse one that would land on existing geometry: an overlapping pair
 * pushes profile building onto the kernel path (`needsKernelSplit`).
 */
export function sameEntityGeometry(
    type: SketchEntityType,
    first: readonly number[],
    otherType: SketchEntityType,
    second: readonly number[],
    tolerance: number,
): boolean {
    // Different kinds lay their params out differently: a line's four slots read against an
    // arc's six happen to line up wherever the numbers agree, matching shapes that are not.
    if (type !== otherType) return false;
    switch (type) {
        case "line":
            return sameLine(first, second, tolerance);
        case "circle":
            return nearPoint(first, second, tolerance) && near(first[2], second[2], tolerance);
        case "ellipse":
            return sameEllipseFrame(first, second, tolerance);
        case "ellipseArc":
            return sameEllipseArc(first, second, tolerance);
        case "conic":
            return sameConic(first, second, tolerance);
        case "bezier":
            return sameBezier(first, second, tolerance);
        default:
            // the rest — a nurbs among them, whose knots are not in `params` and so cannot be
            // compared here: a reversed or re-knotted one simply reads as another curve, which
            // costs the duplicate check a match at worst, never a wrong one
            return sameInPlace(first, second, tolerance);
    }
}

/** Whether `a` and `b` are within `tolerance` of each other. */
function near(a: number, b: number, tolerance: number): boolean {
    return Math.abs(a - b) <= tolerance;
}

/** Whether the points two param vectors start with are in the same place. */
function nearPoint(p: readonly number[], q: readonly number[], tolerance: number): boolean {
    return near(p[0], q[0], tolerance) && near(p[1], q[1], tolerance);
}

/** Whether the params agree slot for slot, read in the same direction. */
function sameInPlace(first: readonly number[], second: readonly number[], tolerance: number): boolean {
    return (
        first.length === second.length && first.every((value, index) => near(value, second[index], tolerance))
    );
}

/** Whether two lines draw one segment: their endpoints are unordered, so either way round. */
function sameLine(first: readonly number[], second: readonly number[], tolerance: number): boolean {
    return (
        (nearPoint(first, second, tolerance) && nearPoint(first.slice(2), second.slice(2), tolerance)) ||
        (nearPoint(first, second.slice(2), tolerance) && nearPoint(first.slice(2), second, tolerance))
    );
}

/** Whether two cubics draw one curve: the same poles in order, or poled in reverse. */
function sameBezier(first: readonly number[], second: readonly number[], tolerance: number): boolean {
    // the same cubic poled in reverse: pole i answers pole 3−i
    const reversed =
        first.length === second.length &&
        nearPoint(first, second.slice(6), tolerance) &&
        nearPoint(first.slice(2), second.slice(4), tolerance) &&
        nearPoint(first.slice(4), second.slice(2), tolerance) &&
        nearPoint(first.slice(6), second, tolerance);
    return sameInPlace(first, second, tolerance) || reversed;
}

/** Whether two conics draw one arc: the same poles in order, or the same arc read end for start. */
function sameConic(first: readonly number[], second: readonly number[], tolerance: number): boolean {
    // the same arc read end-for-start: poles swap places, rho keeps its own
    const reversed =
        nearPoint(first, second.slice(4), tolerance) &&
        nearPoint(first.slice(2), second.slice(2), tolerance) &&
        nearPoint(first.slice(4), second, tolerance) &&
        near(first[6], second[6], tolerance);
    return sameInPlace(first, second, tolerance) || reversed;
}

/** Whether two ellipseArcs draw one curve: one frame, one rim pair, swept the same way round. */
function sameEllipseArc(first: readonly number[], second: readonly number[], tolerance: number): boolean {
    // frame and rim tell an arc from its complement only with the sweep's middle —
    // the two share the frame and the rim point pair
    const rimSame =
        (nearPoint(first.slice(6), second.slice(6), tolerance) &&
            nearPoint(first.slice(8), second.slice(8), tolerance)) ||
        (nearPoint(first.slice(6), second.slice(8), tolerance) &&
            nearPoint(first.slice(8), second.slice(6), tolerance));
    return (
        sameEllipseFrame(first, second, tolerance) &&
        rimSame &&
        nearPoint(ellipseArcMiddle(first), ellipseArcMiddle(second), tolerance)
    );
}

/**
 * Whether two ellipse frames draw one curve: same center, and the axis vectors agreeing
 * up to sign and order — (c, u, v), (c, −u, v) and (c, v, u) all parametrize the same
 * ellipse.
 */
function sameEllipseFrame(first: readonly number[], second: readonly number[], tolerance: number): boolean {
    if (!nearPoint(first, second, tolerance)) return false;
    const u = [first[2] - first[0], first[3] - first[1]];
    const v = [first[4] - first[0], first[5] - first[1]];
    const u2 = [second[2] - second[0], second[3] - second[1]];
    const v2 = [second[4] - second[0], second[5] - second[1]];
    // an axis vector matches up to its sign: the frame point may sit on either end of the axis
    const match = (a: number[], b: number[]) =>
        (near(a[0], b[0], tolerance) && near(a[1], b[1], tolerance)) ||
        (near(a[0], -b[0], tolerance) && near(a[1], -b[1], tolerance));
    return (match(u, u2) && match(v, v2)) || (match(u, v2) && match(v, u2));
}

/**
 * The point an ellipseArc's sweep passes through at its middle. The axes are perpendicular
 * (the structural constraint), so a point's frame angle reads off the axis projections,
 * and the sweep runs counter-clockwise in the frame from the start's angle.
 */
function ellipseArcMiddle(params: readonly number[]): [number, number] {
    const [cx, cy, mx, my, nx, ny, sx, sy, ex, ey] = params;
    const u = [mx - cx, my - cy];
    const v = [nx - cx, ny - cy];
    const angleOf = (x: number, y: number) => {
        const dx = x - cx;
        const dy = y - cy;
        return Math.atan2(
            (dx * v[0] + dy * v[1]) / (v[0] * v[0] + v[1] * v[1]),
            (dx * u[0] + dy * u[1]) / (u[0] * u[0] + u[1] * u[1]),
        );
    };
    const start = angleOf(sx, sy);
    const sweep = (angleOf(ex, ey) - start + Math.PI * 4) % (Math.PI * 2);
    const middle = start + sweep / 2;
    return [
        cx + u[0] * Math.cos(middle) + v[0] * Math.sin(middle),
        cy + u[1] * Math.cos(middle) + v[1] * Math.sin(middle),
    ];
}

/** Sketch (u, v) → world: origin + xvec * u + yvec * v. */
export function toWorld(plane: Plane, u: number, v: number): XYZ {
    return plane.origin.add(plane.xvec.multiply(u)).add(plane.yvec.multiply(v));
}

/**
 * World point → sketch (u, v): project onto the plane, then dot with xvec / yvec.
 */
export function toUV(plane: Plane, point: XYZ): [number, number] {
    const vector = plane.project(point).sub(plane.origin);
    return [vector.dot(plane.xvec), vector.dot(plane.yvec)];
}

/**
 * Sketch-plane units per screen pixel at viewport position (x, y), measured with
 * two rays — exact for both camera types, unlike `worldToScreen` which rounds to
 * whole pixels and collapses small spans at low zoom levels. Undefined when the
 * plane is off-ray or the span collapses.
 *
 * NOTE: the on-plane measure explodes like 1/cos(grazing) as the view turns
 * edge-on to the plane. For screen-constant graphics (annotation text, arrows,
 * pick tolerances) use `viewPixelSize` instead.
 */
export function worldPerPixel(view: IView, plane: Plane, x: number, y: number): number | undefined {
    const p0 = plane.intersectRay(view.rayAt(x, y));
    const p1 = plane.intersectRay(view.rayAt(x + 1, y));
    if (p0 === undefined || p1 === undefined) return undefined;
    const size = p0.distanceTo(p1);
    return size < 1e-12 ? undefined : size;
}

/**
 * World units per screen pixel at `point`, measured on the plane perpendicular to
 * the center ray through that point. Unlike `worldPerPixel` on the sketch plane
 * this stays bounded at any view angle — it depends only on the camera and the
 * depth of `point` — so screen-sized graphics foreshorten naturally with the
 * tilted sketch instead of ballooning as the view turns edge-on.
 */
export function viewPixelSize(view: IView, point: XYZ): number | undefined {
    const cx = view.width / 2;
    const cy = view.height / 2;
    // the center ray, not view.direction(): the measure must come from the same
    // ray family it samples (the two agree on a real camera)
    const direction = view.rayAt(cx, cy).direction;
    let xvec = direction.cross(view.up());
    if (xvec.lengthSq() < 1e-12) {
        // looking straight along the up axis — pick any perpendicular
        xvec = direction.cross(Math.abs(direction.dot(XYZ.unitX)) < 0.9 ? XYZ.unitX : XYZ.unitY);
    }
    const facing = new Plane({ origin: point, normal: direction, xvec });
    return worldPerPixel(view, facing, cx, cy);
}
