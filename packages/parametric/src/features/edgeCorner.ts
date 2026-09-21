// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    type I18nKeys,
    type IEdge,
    type IFace,
    type IShape,
    LENGTH_UNITS,
    Result,
    resolveUnitSpec,
    ShapeTypes,
    type TrackedShape,
    type XYZ,
} from "@chili3d/core";
import { matchEdgeIndexes, matchEdgesAnchored } from "./edgeMatcher";
import { edgeMidPoint } from "./edgeRef";
import {
    type ChamferFeatureData,
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
        ],

        setParameter: (feature, key, value) => ({ ...feature, [key]: value }),

        applyResolvedRefs: (feature, { resolvedEdges }) =>
            resolvedEdges === undefined ? feature : { ...feature, edges: resolvedEdges },

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
            return applyEdgeCorner(options, input, indexes.value, parameter.value, tracking, feature.id);
        },
    };
}

/**
 * The feature's stored edge refs as indexes into the rebuilt input — anchored to the tracked
 * input ids when the body supplies tracking, geometric matching otherwise. Anchored matching
 * also reports the re-anchored refs on the tracking for the body's write-back (see
 * ShapeTracking.resolvedEdges).
 */
function matchCornerEdges(
    input: IShape,
    feature: FilletFeatureData | ChamferFeatureData,
    tracking: ShapeTracking | undefined,
): Result<number[]> {
    if (tracking === undefined) {
        return matchEdgeIndexes(input, feature.edges);
    }
    const matched = matchEdgesAnchored(input, feature.edges, tracking.inputEdgeIds);
    if (!matched.isOk) return Result.err(matched.error);
    // Re-anchored refs for the body's write-back (see ShapeTracking.resolvedEdges).
    tracking.resolvedEdges = matched.value.anchors;
    return Result.ok(matched.value.indexes);
}

/**
 * Applies the corner to `indexes`, preferring the kernel's tracked variant so the result's
 * history can fill the body's output ids (see `trackEdgeCorner`). The plain variant is the
 * fallback whenever the body or the kernel offers no tracking.
 *
 * `featureId` scopes every name the corner MINTS (see the three attribution passes): the names
 * the corner derives come from its input edge, and two corners on the two pieces of one split
 * input edge derive from the very same stem — the feature is what tells them apart.
 */
function applyEdgeCorner<F extends FilletFeatureData | ChamferFeatureData>(
    options: EdgeCornerOptions<F>,
    input: IShape,
    indexes: number[],
    parameter: number,
    tracking: ShapeTracking | undefined,
    featureId: string,
): Result<IShape> {
    // A picked SEAM edge (one face on both sides) is refused by the factory itself — the only
    // layer that calls the kernel, and the only one that can refuse before OCCT raises (see
    // `seamError` in the wasm factory; the release build turns a raise into a module abort).
    const tracked = options.method === "fillet" ? shapeFactory.filletTracked : shapeFactory.chamferTracked;
    if (tracking === undefined || tracked === undefined) {
        return shapeFactory[options.method](input, indexes, parameter);
    }
    const result = tracked(input, indexes, parameter);
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
        parameter,
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
    parameter: number,
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
            const matches = targets.filter((target) => builtFrom(edge, target.edge, parameter));
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
 * `parameter` away from the edge it was built on, so
 * - an end ARC is coaxial with that edge and its two tangent ends sit `parameter` away from it;
 * - a seam LINE runs past it at that same distance.
 *
 * What it does NOT reach, both deliberately:
 * - a chamfer's slanted END edges — they cross the corner rather than running alongside it
 *   (`withinSpan` and the parallel test both fail);
 * - anything on a non-orthogonal dihedral — the distance a corner's surface keeps from the edge
 *   is `radius / tan(α/2)`, which equals the parameter only at 90°, and the test compares it to
 *   the parameter. This measure deliberately does not reach them; `attributeCornerBornEdges`
 *   names what is left, by the faces the edge borders instead.
 *
 * Distance — not "the projection lands on the line" — is what tells one corner's edges from
 * another's: every filleted edge of a box shares its endpoints' planes, so a looser test
 * matches all four (measured: an arc matched four input edges).
 */
function builtFrom(edge: IEdge, inputEdge: IEdge, parameter: number): boolean {
    const chord = inputEdge.endPoint().sub(inputEdge.startPoint());
    // A CLOSED input edge (a full circle — a boss's top rim, a bore's rim) has no chord to take a
    // direction from and no span to stay within, so every measure below is inapplicable there:
    // the chord is the zero vector, and `directionsParallel` against it rejected every candidate,
    // which is what silently left the whole result of such a fillet — its surface and both of
    // its boundaries — with no id. The closed-edge form of the same question is "how far is this
    // edge from the edge it was built on": the round's boundaries both stay `parameter` from the
    // rounded edge's CURVE, radially (the side below is trimmed `parameter` short of the rim,
    // the face above shrinks by `parameter`).
    if (chord.length() <= MATCH_TOLERANCE) return atCurveDistance(edge, inputEdge, parameter);

    const direction = chord.normalize();
    const basis = edge.curve.basisCurve;
    const atDistance = (point: XYZ) => Math.abs(distance(projectionOn(inputEdge, point), point) - parameter);
    if (CurveUtils.isCircle(basis)) {
        if (!directionsParallel(basis.axis, direction)) return false;
        return (
            [edge.startPoint(), edge.endPoint()].every((end) => atDistance(end) <= MATCH_TOLERANCE) &&
            withinSpan(edge, inputEdge)
        );
    }
    if (CurveUtils.isLine(basis)) {
        return (
            directionsParallel(edge.endPoint().sub(edge.startPoint()), direction) &&
            atDistance(edgeMidPoint(edge)) <= MATCH_TOLERANCE &&
            withinSpan(edge, inputEdge)
        );
    }
    // Anything else: a trimmed remnant the kernel's own history missed.
    return edgeLiesOn(edge, inputEdge);
}

/**
 * True when every probe of `edge` sits `parameter` from `inputEdge`'s own curve — the
 * closed-edge measure of `builtFrom` (see it).
 *
 * Probing the curve, not a supporting line, is what makes it work for a closed edge: there is no
 * infinite line to project onto, and the boundaries of the round around it are offset radially,
 * not along any one direction. Every probe is required — one point of a long edge could sit at
 * the right distance by accident, a whole edge of the round cannot.
 */
function atCurveDistance(edge: IEdge, inputEdge: IEdge, parameter: number): boolean {
    const [first, last] = [edge.firstParameter(), edge.lastParameter()];
    const probes = [edge.pointAt(first), edge.pointAt((first + last) / 2), edge.pointAt(last)];
    return probes.every(
        (point) => Math.abs(inputEdge.curve.nearestFromPoint(point).distance - parameter) <= MATCH_TOLERANCE,
    );
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

registerFeature(
    "fillet",
    edgeCornerHandler<FilletFeatureData>({
        display: "command.feature.fillet",
        icon: "icon-fillet",
        method: "fillet",
        parameterKey: "radius",
        parameterDisplay: "circle.radius",
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
    }),
);
