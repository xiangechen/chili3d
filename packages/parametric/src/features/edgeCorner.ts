// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    CurveUtils,
    type FeatureParameter,
    type I18nKeys,
    type IEdge,
    type IFace,
    type IShape,
    LENGTH_UNITS,
    MathUtils,
    type ParameterValue,
    Result,
    resolveUnitSpec,
    ShapeTypes,
    type TrackedShape,
    type XYZ,
} from "@chili3d/core";
import { matchEdgeIndexes, matchEdgesAnchored } from "./edgeMatcher";
import { edgeMidPoint, withoutHoles } from "./edgeRef";
import {
    type ChamferFeatureData,
    type ChamferMode,
    type CompletedTrackedHistory,
    completeTrackedHistory,
    type FeatureContext,
    type FeatureHandler,
    type FilletFeatureData,
    registerFeature,
    type ShapeTracking,
    trackedIds,
} from "./feature";
import { bornEdgeIdMap } from "./operationIds";
import { edgeLiesOn } from "./profileEntities";
import { directionsParallel, distance, MATCH_TOLERANCE } from "./refGeometry";
import { boundaryId, derivedId, prefixedId, writeUncontestedIds } from "./trackedId";

interface EdgeCornerOptions<F extends FilletFeatureData | ChamferFeatureData> {
    readonly display: I18nKeys;
    readonly icon: string;
    readonly method: "fillet" | "chamfer";
    readonly parameterKey: keyof F & string;
    readonly parameterDisplay: I18nKeys;
    /** Parameter rows after the main one (chamfer's mode/distance2/angle/flip, fillet's radius2). */
    readonly extraParameters?: (feature: F) => FeatureParameter[];
    /** Custom parameter writes (token validation for dropdowns); the default merges the key. */
    readonly setParameter?: FeatureHandler<F>["setParameter"];
    /**
     * The kernel call this evaluation makes, given the resolved main parameter — the
     * two-distance chamfer and the variable-radius fillet build theirs here. Absent: the
     * plain single-parameter `fillet`/`chamfer` call.
     */
    readonly resolveCall?: (
        feature: F,
        input: IShape,
        indexes: readonly number[],
        parameter: number,
        context: FeatureContext,
    ) => Result<CornerCall>;
}

/**
 * One corner evaluation's kernel invocation: the tracked variant is preferred (its history
 * fills the body's output ids), the plain one is the fallback when the body or the kernel
 * offers no tracking. `parameters` carries the corner's own measures for `builtFrom`'s
 * distance discrimination — [radius] / [distance] for the constant corners, [d1, d2] for a
 * two-distance chamfer, [R1, R2] for a variable fillet; `interpolated` marks the one case
 * the distance VARIES along the edge (the variable fillet), whose edges are told apart by
 * their endpoints instead (see `endpointBuiltFrom`).
 */
interface CornerCall {
    readonly parameters: readonly number[];
    readonly interpolated?: boolean;
    readonly plain: (input: IShape, indexes: number[]) => Result<IShape>;
    readonly tracked?: (input: IShape, indexes: number[]) => Result<TrackedShape>;
}

/**
 * Shared handler for edge-modifying features (fillet/chamfer): edge references carry a
 * stable kernel-history id when available (matched exactly) plus a geometric
 * fingerprint fallback, re-matched against the rebuilt input on every evaluation —
 * shape indices drift when upstream features regenerate.
 */
function edgeCornerHandler<F extends FilletFeatureData | ChamferFeatureData>(
    options: EdgeCornerOptions<F>,
): FeatureHandler<F> {
    return {
        display: options.display,
        icon: options.icon,
        reselectable: true,

        nodeIds: () => [],

        parameters: (feature) => [
            {
                key: options.parameterKey,
                display: options.parameterDisplay,
                value: feature[options.parameterKey] as number | string,
                unit: LENGTH_UNITS,
            },
            ...(options.extraParameters?.(feature) ?? []),
        ],

        setParameter: (feature, key, value) =>
            options.setParameter?.(feature, key, value) ?? { ...feature, [key]: value },

        applyResolvedRefs: (feature, { resolvedEdges }) =>
            resolvedEdges === undefined
                ? feature
                : // `edges` is a set; a slot the shared channel left empty (see `withoutHoles`)
                  // simply does not belong in it.
                  { ...feature, edges: withoutHoles(resolvedEdges) },

        evaluate(feature, context: FeatureContext): Result<IShape> {
            const input = context.input;
            if (input === undefined) {
                return Result.err(`${feature.type} requires a preceding feature`);
            }
            const parameter = resolveUnitSpec(
                feature[options.parameterKey] as number | string,
                context.scope,
                LENGTH_UNITS,
            );
            if (!parameter.isOk) return Result.err(parameter.error);
            const tracking = context.tracking;
            const indexes = matchCornerEdges(input, feature, tracking);
            if (!indexes.isOk) return Result.err(indexes.error);
            const call = options.resolveCall
                ? options.resolveCall(feature, input, indexes.value, parameter.value, context)
                : defaultCornerCall(options.method, parameter.value);
            if (!call.isOk) return Result.err(call.error);
            return applyEdgeCorner(input, indexes.value, call.value, tracking, feature.id);
        },
    };
}

/** The constant corner's kernel call — `fillet`/`chamfer` with their one parameter. */
function defaultCornerCall(method: "fillet" | "chamfer", parameter: number): Result<CornerCall> {
    const tracked = method === "fillet" ? shapeFactory.filletTracked : shapeFactory.chamferTracked;
    return Result.ok({
        parameters: [parameter],
        plain: (input, indexes) => shapeFactory[method](input, indexes, parameter),
        tracked: tracked === undefined ? undefined : (input, indexes) => tracked(input, indexes, parameter),
    });
}

/**
 * The feature's stored edge refs as indexes into the rebuilt input — anchored to the tracked
 * input ids when the body supplies tracking, geometric matching otherwise. Anchored matching
 * also reports the re-anchored refs on the tracking for the body's write-back (see
 * ShapeTracking.resolvedEdges).
 */
export function matchCornerEdges(
    input: IShape,
    feature: FilletFeatureData | ChamferFeatureData,
    tracking: ShapeTracking | undefined,
): Result<number[]> {
    if (tracking === undefined) {
        return matchEdgeIndexes(input, feature.edges);
    }
    const matched = matchEdgesAnchored(input, feature.edges, tracking.inputEdgeIds);
    if (!matched.isOk) return Result.err(matched.error);
    // Re-anchored refs for the body's write-back (see ShapeTracking.resolvedEdges). Every slot is
    // filled: a ref the matcher cannot find at all fails the match rather than leaving a hole.
    tracking.resolvedEdges = matched.value.anchors;
    return Result.ok(matched.value.indexes);
}

/**
 * Applies the corner to `indexes`, preferring the call's tracked variant so the result's
 * history can fill the body's output ids (see `trackEdgeCorner`). The plain variant is the
 * fallback whenever the body or the kernel offers no tracking.
 *
 * `featureId` scopes every name the corner MINTS (see the three attribution passes): the names
 * the corner derives come from its input edge, and two corners on the two pieces of one split
 * input edge derive from the very same stem — the feature is what tells them apart.
 */
function applyEdgeCorner(
    input: IShape,
    indexes: number[],
    call: CornerCall,
    tracking: ShapeTracking | undefined,
    featureId: string,
): Result<IShape> {
    // A picked SEAM edge (one face on both sides) is refused by the factory itself — the only
    // layer that calls the kernel, and the only one that can refuse before OCCT raises (see
    // `seamError` in the wasm factory; the release build turns a raise into a module abort).
    if (tracking === undefined || call.tracked === undefined) {
        return call.plain(input, indexes);
    }
    const result = call.tracked(input, indexes);
    if (!result.isOk) return Result.err(result.error);
    const completed = completeTrackedHistory([input], result.value);
    tracking.outputFaceIds = trackedIds(tracking.inputFaceIds, completed.faceMap);
    tracking.outputEdgeIds = trackedIds(tracking.inputEdgeIds, completed.edgeMap);
    // Three passes, in order: the seams name the corner's surface, and the surface names
    // whatever else the corner left over (see each function).
    const ownedEdges = attributeCornerEdges(
        input,
        tracking,
        result.value,
        completed,
        indexes,
        call,
        featureId,
    );
    attributeCornerFaces(result.value.shape, completed, tracking, ownedEdges, featureId);
    attributeCornerBornEdges(result.value.shape, completed, tracking, featureId);
    return Result.ok(result.value.shape);
}

/**
 * Names the corner's own new edges by content, in place: the kernel reports the edges it
 * TRIMMED off the input (they keep the input's ids), but nothing derives the surface it
 * builds — the two seam lines and the two end arcs of a fillet (measured on a box: 8 of 24
 * output edges), nor a chamfer's own strips. Left alone those have no id at all, so a
 * reference to one has to be re-found geometrically.
 *
 * Every such edge is fully determined by the input edge it was built on plus the inherited
 * FACE it borders, and both have stable ids:
 *
 * - **which input edge** — the filleted input edges are the `indexes` this run was asked for,
 *   and the relation is exact: an end arc's center projects onto one of the edge's endpoints,
 *   a seam line runs parallel to it and alongside its span;
 * - **which face** — the edge's adjacent faces (`findAncestor`); the corner's surface is a NEW
 *   face (`faceMap < 0`), so the inherited one names the side the edge borders. Its id is what
 *   the suffix carries, which is also what tells two seams of one edge apart.
 * - **which corner built it** — `prefixedId(featureId, …)`, because the two above are NOT enough
 *   to tell two corners apart: the two pieces of one split input edge border the SAME face pair,
 *   so both corners compute the same `<inputEdge>:f<face>` for their seams and the same
 *   `<inputEdge>:f` for their surfaces — measured on a box whose front bottom edge a fused bump
 *   split in two, both fillets' seams came out literally identical.
 *
 * The attribution is taken only when it is unambiguous: one input edge, at least one inherited
 * face whose id is itself stable, and a candidate id no sibling edge also computes. Anything
 * else stays unnamed rather than take an id another sub-shape could also claim.
 *
 * Returns the accepted edges — output edge index → the input edge it was built on — which is
 * what lets `attributeCornerFaces` find the surface these seams bound.
 */
function attributeCornerEdges(
    input: IShape,
    tracking: ShapeTracking,
    result: TrackedShape,
    completed: CompletedTrackedHistory,
    indexes: readonly number[],
    call: CornerCall,
    featureId: string,
): Map<number, string> {
    const accepted = new Map<number, string>();
    const inputEdges = input.findSubShapes(ShapeTypes.edge) as IEdge[];
    const targets = indexes.flatMap((index) => {
        const edge = inputEdges[index];
        const id = tracking.inputEdgeIds[index];
        return edge === undefined || id === undefined ? [] : [{ edge, id }];
    });
    if (targets.length === 0) return accepted;

    const candidates = new Map<number, string>();
    const owners = new Map<number, string>();
    completed.outputEdges.forEach((edge, outputIndex) => {
        if (completed.edgeMap[outputIndex] >= 0) return;
        try {
            const matches = targets.filter((target) => builtFrom(edge, target.edge, call));
            const suffix =
                matches.length === 1
                    ? inheritedFaceSuffix(edge, result.shape, completed.outputFaces, tracking.outputFaceIds)
                    : undefined;
            if (matches.length !== 1 || suffix === undefined) return;
            candidates.set(outputIndex, prefixedId(featureId, derivedId(matches[0].id, suffix)));
            owners.set(outputIndex, matches[0].id);
        } catch {
            // A degenerate edge (its kernel queries throw, and the release build turns an OCCT
            // failure into a JS-level throw): no attribution, it stays unnamed.
        }
    });

    for (const index of writeUncontestedIds(tracking.outputEdgeIds, candidates)) {
        const owner = owners.get(index);
        if (owner !== undefined) accepted.set(index, owner);
    }
    return accepted;
}

/**
 * Names the corner's own new FACE — the surface the kernel builds in place of the edge it
 * rounds off. The kernel's face history does not derive it: a fillet's cylinder is Generated
 * from an EDGE, and `faceHistory` only asks what each INPUT FACE became (`faceMap < 0` here).
 *
 * So it is named through the relation `attributeCornerEdges` has just established: the edges
 * bounding a corner's surface are the seams named for ONE input edge, which makes that edge
 * the face's corner. `derivedId` hangs the suffix off every leaf, so an edge that later merges
 * with a collinear neighbour (`A|B`) yields `A:f|B:f` — a compound a reference captured on
 * either half still intersects. `prefixedId` scopes the whole thing under the producing feature,
 * the same way `attributeCornerEdges` does — the two corners on the two pieces of a split edge
 * own the same input edge, so without the scope both surfaces would compute one id.
 *
 * Taken only when exactly one input edge owns the face; a surface two corners both bound
 * (where fillets meet at a vertex) stays unnamed rather than take an id both would claim.
 */
function attributeCornerFaces(
    shape: IShape,
    completed: CompletedTrackedHistory,
    tracking: ShapeTracking,
    ownedEdges: ReadonlyMap<number, string>,
    featureId: string,
): void {
    if (ownedEdges.size === 0) return;
    const owners = cornerFaceOwners(shape, completed, ownedEdges);

    const candidates = new Map<number, string>();
    for (const [index, set] of owners) {
        if (set.size !== 1 || tracking.outputFaceIds[index] !== undefined) continue;
        candidates.set(index, prefixedId(featureId, derivedId([...set][0], ":f")));
    }
    writeUncontestedIds(tracking.outputFaceIds, candidates);
}

/**
 * Which input edge owns which corner surface: output-face index → the input edges having a seam
 * on it. A face the kernel rebuilt from an input face is left out — it keeps that input's id, and
 * only the corner's own surface is derived here.
 *
 * An edge whose kernel queries throw contributes nothing: the release build turns an OCCT failure
 * into a JS-level throw, and a degenerate seam has no face to name.
 */
function cornerFaceOwners(
    shape: IShape,
    completed: CompletedTrackedHistory,
    ownedEdges: ReadonlyMap<number, string>,
): Map<number, Set<string>> {
    const owners = new Map<number, Set<string>>();
    for (const [edgeIndex, inputEdgeId] of ownedEdges) {
        const edge = completed.outputEdges[edgeIndex];
        try {
            for (const face of edge.findAncestor(ShapeTypes.face, shape) as IFace[]) {
                const index = completed.outputFaces.findIndex((candidate) => candidate.isSame(face));
                if (index < 0 || completed.faceMap[index] >= 0) continue;
                const set = owners.get(index) ?? new Set<string>();
                set.add(inputEdgeId);
                owners.set(index, set);
            }
        } catch {
            // A degenerate edge — it contributes no face.
        }
    }
    return owners;
}

/**
 * Names what the corner left over by the FACES it borders — `bornEdgeIdMap`'s rule, applied to
 * the corner's output (see it for the reasoning and the two guards).
 *
 * It reaches the edges `builtFrom` cannot, because they cross the corner instead of running
 * alongside it: a fillet end edge TRUNCATED by a neighbouring solid, and a chamfer's slanted
 * ends (measured on a box: 8 of 24 output edges, pinned until now by
 * `edgeIdEnumerationDrift.kernel.test.ts`). `attributeCornerFaces` has named the corner's
 * surface by this point, so the pair is stable on both sides.
 *
 * Its names carry the feature scope too (`prefixedId`) — not because a face-pair conjunction can
 * repeat across corners (it cannot: the pair includes the corner's own surface), but so every
 * name a corner mints reads the same way, and none of them can collide with the unscoped ids
 * `bornEdgeIdMap` gives the booleans sharing its rule.
 */
function attributeCornerBornEdges(
    shape: IShape,
    completed: CompletedTrackedHistory,
    tracking: ShapeTracking,
    featureId: string,
): void {
    const born = bornEdgeIdMap(
        shape,
        completed.outputEdges,
        completed.outputFaces,
        tracking.outputFaceIds,
        // Still unnamed: `attributeCornerEdges` has already named the seams it could reach.
        (index) => completed.edgeMap[index] < 0 && tracking.outputEdgeIds[index] === undefined,
    );
    for (const [index, id] of born) {
        tracking.outputEdgeIds[index] = prefixedId(featureId, id);
    }
}

/**
 * True when `edge` is one of the edges the corner built on `inputEdge`.
 *
 * The discriminating measure is the corner's own parameter: the surface it builds stands
 * `call.parameters` away from the edge it was built on, so
 * - an end ARC is coaxial with that edge and its two tangent ends sit at one of those
 *   distances from it;
 * - a seam LINE runs past it at that same distance.
 *
 * A two-distance chamfer passes BOTH distances (each seam keeps its own side's); a
 * variable-radius fillet is measured by `endpointBuiltFrom` instead (see it).
 *
 * What it does NOT reach, both deliberately:
 * - a chamfer's slanted END edges — they cross the corner rather than running alongside it
 *   (`withinSpan` and the parallel test both fail);
 * - anything on a non-orthogonal dihedral — the distance a corner's surface keeps from the
 *   edge is `radius / tan(α/2)`, which equals the parameter only at 90°, and the test compares
 *   it to the parameter. This measure deliberately does not reach them; `attributeCornerBornEdges`
 *   names what is left, by the faces the edge borders instead.
 *
 * Distance — not "the projection lands on the line" — is what tells one corner's edges from
 * another's: every filleted edge of a box shares its endpoints' planes, so a looser test
 * matches all four (measured: an arc matched four input edges).
 */
function builtFrom(edge: IEdge, inputEdge: IEdge, call: CornerCall): boolean {
    if (call.interpolated === true) return endpointBuiltFrom(edge, inputEdge, call.parameters);
    const chord = inputEdge.endPoint().sub(inputEdge.startPoint());
    // A CLOSED input edge (a full circle — a boss's top rim, a bore's rim) has no chord to take a
    // direction from and no span to stay within, so every measure below is inapplicable there:
    // the chord is the zero vector, and `directionsParallel` against it rejected every candidate,
    // which is what silently left the whole result of such a fillet — its surface and both of
    // its boundaries — with no id. The closed-edge form of the same question is "how far is this
    // edge from the edge it was built on": the round's boundaries both stay `parameter` from the
    // rounded edge's CURVE, radially (the side below is trimmed `parameter` short of the rim,
    // the face above shrinks by `parameter`).
    if (chord.length() <= MATCH_TOLERANCE) return atCurveDistance(edge, inputEdge, call);

    const direction = chord.normalize();
    const basis = edge.curve.basisCurve;
    const hits = (point: XYZ) => parameterHit(distance(projectionOn(inputEdge, point), point), call);
    if (CurveUtils.isCircle(basis)) {
        if (!directionsParallel(basis.axis, direction)) return false;
        return [edge.startPoint(), edge.endPoint()].every((end) => hits(end)) && withinSpan(edge, inputEdge);
    }
    if (CurveUtils.isLine(basis)) {
        return (
            directionsParallel(edge.endPoint().sub(edge.startPoint()), direction) &&
            hits(edgeMidPoint(edge)) &&
            withinSpan(edge, inputEdge)
        );
    }
    // Anything else: a trimmed remnant the kernel's own history missed.
    return edgeLiesOn(edge, inputEdge);
}

/** True when `measured` hits one of the corner's parameters within tolerance. */
function parameterHit(measured: number, call: CornerCall): boolean {
    return call.parameters.some((p) => Math.abs(measured - p) <= MATCH_TOLERANCE);
}

/**
 * The interpolated corner's measure (a variable-radius fillet): BOTH endpoints sit exactly at
 * one of the two end radii from the input edge's curve — a seam runs from the R1 station to
 * the R2 one, an end trim closes one end at that end's own radius. Only the endpoints are
 * probed: the kernel builds the corner's curves as B-splines whose midpoints dip far inside
 * the [R1, R2] interval (measured: an end trim's midpoint at (√2−1)·R from the edge, and a
 * seam's at the mid-radius), so neither the constant corner's exact-distance test nor any
 * interval test reaches them. An open input edge's span still gates strays running alongside
 * it, and the caller's ambiguity guard (`matches.length === 1`) disowns anything two corners
 * both reach.
 */
function endpointBuiltFrom(edge: IEdge, inputEdge: IEdge, parameters: readonly number[]): boolean {
    const atRadius = (point: XYZ) => {
        const measured = inputEdge.curve.nearestFromPoint(point).distance;
        return parameters.some((p) => Math.abs(measured - p) <= MATCH_TOLERANCE);
    };
    if (![edge.startPoint(), edge.endPoint()].every(atRadius)) return false;
    const chord = inputEdge.endPoint().sub(inputEdge.startPoint());
    return chord.length() <= MATCH_TOLERANCE || withinSpan(edge, inputEdge);
}

/**
 * True when every probe of `edge` sits at the corner's parameter from `inputEdge`'s own
 * curve — the closed-edge measure of `builtFrom` (see it).
 *
 * Probing the curve, not a supporting line, is what makes it work for a closed edge: there is no
 * infinite line to project onto, and the boundaries of the round around it are offset radially,
 * not along any one direction. Every probe is required — one point of a long edge could sit at
 * the right distance by accident, a whole edge of the round cannot.
 */
function atCurveDistance(edge: IEdge, inputEdge: IEdge, call: CornerCall): boolean {
    const [first, last] = [edge.firstParameter(), edge.lastParameter()];
    const probes = [edge.pointAt(first), edge.pointAt((first + last) / 2), edge.pointAt(last)];
    return probes.every((point) => parameterHit(inputEdge.curve.nearestFromPoint(point).distance, call));
}

/** The id of the inherited face(s) this edge borders — undefined when none carries a stable id. */
function inheritedFaceSuffix(
    edge: IEdge,
    shape: IShape,
    outputFaces: readonly IFace[],
    outputFaceIds: readonly (string | undefined)[],
): string | undefined {
    const faces = edge.findAncestor(ShapeTypes.face, shape) as IFace[];
    const ids = faces.flatMap((face) => {
        const index = outputFaces.findIndex((candidate) => candidate.isSame(face));
        const id = index < 0 ? undefined : outputFaceIds[index];
        return id === undefined ? [] : [id];
    });
    if (ids.length === 0) return undefined;
    return `:f${boundaryId(ids)}`;
}

/** The perpendicular foot of `point` on `edge`'s supporting line; the start point for a degenerate edge. */
function projectionOn(edge: IEdge, point: XYZ): XYZ {
    const start = edge.startPoint();
    const direction = edge.endPoint().sub(start).normalize();
    if (direction === undefined) return start;
    return start.add(direction.multiply(point.sub(start).dot(direction)));
}

/** True when `edge`'s midpoint projects inside `inputEdge`'s span. */
function withinSpan(edge: IEdge, inputEdge: IEdge): boolean {
    const foot = projectionOn(inputEdge, edgeMidPoint(edge));
    return (
        distance(foot, inputEdge.startPoint()) <= inputEdge.length() + MATCH_TOLERANCE &&
        distance(foot, inputEdge.endPoint()) <= inputEdge.length() + MATCH_TOLERANCE
    );
}

const CHAMFER_MODES: readonly ChamferMode[] = ["equal", "twoDistance", "distanceAngle"];

const CHAMFER_MODE_DISPLAY: Record<ChamferMode, I18nKeys> = {
    equal: "feature.chamfer.mode.equal",
    twoDistance: "feature.chamfer.mode.twoDistance",
    distanceAngle: "feature.chamfer.mode.distanceAngle",
};

/**
 * The chamfer's kernel call for its mode: `equal` is the plain constant chamfer; the
 * asymmetric modes go through `chamferTwoDist` with one reference face per edge — the
 * edge's first adjacent face, or the second when `flip` is set (`distance` is measured on
 * that face, the second offset on the other). `distanceAngle` derives the second offset as
 * `distance · tan(angle)`.
 */
function resolveChamferCall(
    feature: ChamferFeatureData,
    input: IShape,
    indexes: readonly number[],
    d1: number,
    context: FeatureContext,
): Result<CornerCall> {
    const mode = feature.mode ?? "equal";
    // The dropdown keeps the panel from writing a bad token; this keeps a hand-edited file
    // from reaching geometry that would read it wrong (the shell's join-type guard's twin).
    if (!CHAMFER_MODES.includes(mode)) return Result.err(`Invalid chamfer mode: ${mode}`);
    if (mode === "equal") return defaultCornerCall("chamfer", d1);

    const d2 = resolveSecondDistance(feature, mode, d1, context);
    if (!d2.isOk) return Result.err(d2.error);
    const faces = referenceFaces(input, indexes, feature.flip === true);
    if (!faces.isOk) return Result.err(faces.error);
    const tracked = shapeFactory.chamferTwoDistTracked;
    const plain = shapeFactory.chamferTwoDist;
    const faceIndexes = faces.value;
    const offset2 = d2.value;
    return Result.ok({
        parameters: [d1, offset2],
        plain: (i, idx) =>
            plain === undefined
                ? Result.err("The kernel does not support two-distance chamfers")
                : plain(i, idx, d1, offset2, faceIndexes),
        tracked: tracked === undefined ? undefined : (i, idx) => tracked(i, idx, d1, offset2, faceIndexes),
    });
}

/**
 * The second offset of an asymmetric chamfer: `twoDistance` resolves `distance2`,
 * `distanceAngle` computes `d1 · tan(angle)` from `angle` (degrees, 0 < angle < 90 —
 * tan(90°) is unbounded, and a zero offset is no chamfer at all).
 */
function resolveSecondDistance(
    feature: ChamferFeatureData,
    mode: "twoDistance" | "distanceAngle",
    d1: number,
    context: FeatureContext,
): Result<number> {
    if (mode === "twoDistance") {
        if (feature.distance2 === undefined || feature.distance2 === "") {
            return Result.err("A two-distance chamfer requires distance2");
        }
        return resolveUnitSpec(feature.distance2, context.scope, LENGTH_UNITS);
    }
    if (feature.angle === undefined || feature.angle === "") {
        return Result.err("A distance-angle chamfer requires an angle");
    }
    const angle = resolveUnitSpec(feature.angle, context.scope, ANGLE_UNITS);
    if (!angle.isOk) return Result.err(angle.error);
    if (angle.value <= 0 || angle.value >= 90) {
        return Result.err("A distance-angle chamfer's angle must lie between 0° and 90°");
    }
    return Result.ok(d1 * Math.tan(MathUtils.degToRad(angle.value)));
}

/**
 * The reference face of each edge, as indexes into the input's face enumeration: the
 * edge's first adjacent face, or the second when flipped (OCCT's Add(d1, d2, edge, face)
 * measures d1 ON that face). Adjacent faces are deduplicated — a seam edge (one face on
 * both sides) is refused by the factory itself.
 */
function referenceFaces(input: IShape, indexes: readonly number[], flip: boolean): Result<number[]> {
    const edges = input.findSubShapes(ShapeTypes.edge) as IEdge[];
    const faces = input.findSubShapes(ShapeTypes.face) as IFace[];
    const result: number[] = [];
    for (const index of indexes) {
        const edge = edges[index];
        if (edge === undefined) return Result.err(`Chamfer edge ${index} is out of range`);
        let adjacent: IFace[];
        try {
            adjacent = (edge.findAncestor(ShapeTypes.face, input) as IFace[]).filter(
                (face, position, all) => all.findIndex((candidate) => candidate.isSame(face)) === position,
            );
        } catch {
            // A degenerate edge (its kernel queries throw, and the release build turns an
            // OCCT failure into a JS-level throw): refuse here rather than in the kernel.
            return Result.err(`Chamfer edge ${index} has no readable adjacent faces`);
        }
        const chosen = adjacent[flip && adjacent.length > 1 ? 1 : 0];
        const faceIndex = chosen === undefined ? -1 : faces.findIndex((face) => face.isSame(chosen));
        if (faceIndex < 0) return Result.err(`Chamfer edge ${index} has no adjacent face`);
        result.push(faceIndex);
    }
    return Result.ok(result);
}

/**
 * The fillet's kernel call: the plain constant-radius fillet when `radius2` is absent or
 * equals `radius`, OCCT's two-radius fillet otherwise — `radius` at every edge's start
 * vertex, `radius2` at its end, interpolated linearly along the edge (so `parameters`
 * spans the interval for `builtFrom`'s probes, and `interpolated` marks it varies).
 */
function resolveFilletCall(
    feature: FilletFeatureData,
    _input: IShape,
    indexes: readonly number[],
    radius: number,
    context: FeatureContext,
): Result<CornerCall> {
    if (feature.radius2 === undefined || feature.radius2 === "") {
        return defaultCornerCall("fillet", radius);
    }
    const radius2 = resolveUnitSpec(feature.radius2, context.scope, LENGTH_UNITS);
    if (!radius2.isOk) return Result.err(radius2.error);
    if (radius2.value === radius) return defaultCornerCall("fillet", radius);

    const radii = indexes.flatMap(() => [radius, radius2.value]);
    const plain = shapeFactory.filletVariable;
    const tracked = shapeFactory.filletVariableTracked;
    return Result.ok({
        parameters: [radius, radius2.value],
        interpolated: true,
        plain: (i, idx) =>
            plain === undefined
                ? Result.err("The kernel does not support variable-radius fillets")
                : plain(i, idx, radii),
        tracked: tracked === undefined ? undefined : (i, idx) => tracked(i, idx, radii),
    });
}

registerFeature(
    "fillet",
    edgeCornerHandler<FilletFeatureData>({
        display: "command.feature.fillet",
        icon: "icon-fillet",
        method: "fillet",
        parameterKey: "radius",
        parameterDisplay: "circle.radius",
        extraParameters: (feature) => [
            // An empty field is the constant-radius fillet — the feature carries no
            // `radius2` then at all (the hole's depth pattern).
            {
                key: "radius2",
                display: "feature.fillet.radius2",
                value: feature.radius2 ?? "",
                unit: LENGTH_UNITS,
            },
        ],
        setParameter: (feature, key, value) => {
            if (typeof value === "boolean") return feature;
            if (key === "radius2") {
                const { radius2: _, ...rest } = feature;
                return value === "" ? rest : { ...rest, radius2: value };
            }
            return { ...feature, [key]: value };
        },
        resolveCall: resolveFilletCall,
    }),
);

registerFeature(
    "chamfer",
    edgeCornerHandler<ChamferFeatureData>({
        display: "command.feature.chamfer",
        icon: "icon-chamfer",
        method: "chamfer",
        parameterKey: "distance",
        parameterDisplay: "common.length",
        extraParameters: (feature) => [
            {
                key: "mode",
                display: "feature.chamfer.mode",
                value: feature.mode ?? "equal",
                choices: CHAMFER_MODES.map((value) => ({ value, display: CHAMFER_MODE_DISPLAY[value] })),
            },
            {
                key: "distance2",
                display: "feature.chamfer.distance2",
                value: feature.distance2 ?? "",
                unit: LENGTH_UNITS,
                visibleWhen: [{ key: "mode", value: "twoDistance" }],
            },
            {
                key: "angle",
                display: "feature.chamfer.angle",
                value: feature.angle ?? "",
                unit: ANGLE_UNITS,
                visibleWhen: [{ key: "mode", value: "distanceAngle" }],
            },
            {
                key: "flip",
                display: "feature.chamfer.flip",
                value: feature.flip ?? false,
                visibleWhen: [{ key: "mode", value: ["twoDistance", "distanceAngle"] }],
            },
        ],
        setParameter: (feature, key, value) => {
            if (key === "mode") {
                return CHAMFER_MODES.includes(value as ChamferMode)
                    ? { ...feature, mode: value as ChamferMode }
                    : feature;
            }
            if (key === "flip") return typeof value === "boolean" ? { ...feature, flip: value } : feature;
            if (typeof value === "boolean") return feature;
            if (key === "distance2" || key === "angle") {
                // A blank field clears the value — the evaluate then reports it missing.
                const { [key]: _, ...rest } = feature;
                return value === "" ? rest : { ...rest, [key]: value };
            }
            return { ...feature, [key]: value };
        },
        resolveCall: resolveChamferCall,
    }),
);
