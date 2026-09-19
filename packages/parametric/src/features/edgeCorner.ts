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
    type Scope,
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
import { edgeLiesOn } from "./profileEntities";
import { directionsParallel, distance, MATCH_TOLERANCE } from "./refGeometry";
import { boundaryId, derivedId, isPositionalId, uncontested } from "./trackedId";

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
            const parameter = resolveCornerParameter(feature, context.scope, options);
            if (!parameter.isOk) return Result.err(parameter.error);
            const tracking = context.tracking;
            const indexes = matchCornerEdges(input, feature, tracking);
            if (!indexes.isOk) return Result.err(indexes.error);
            return applyEdgeCorner(feature, options, input, indexes.value, parameter.value, tracking);
        },
    };
}

/** The feature's radius/distance as a concrete length: the stored parameter resolved in the document's scope. */
function resolveCornerParameter<F extends FilletFeatureData | ChamferFeatureData>(
    feature: F,
    scope: Scope,
    options: EdgeCornerOptions<F>,
): Result<number> {
    return resolveUnitSpec(feature[options.parameterKey] as number | string, scope, LENGTH_UNITS);
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
 */
function applyEdgeCorner<F extends FilletFeatureData | ChamferFeatureData>(
    feature: F,
    options: EdgeCornerOptions<F>,
    input: IShape,
    indexes: number[],
    parameter: number,
    tracking: ShapeTracking | undefined,
): Result<IShape> {
    const tracked = options.method === "fillet" ? shapeFactory.filletTracked : shapeFactory.chamferTracked;
    if (tracking === undefined || tracked === undefined) {
        return shapeFactory[options.method](input, indexes, parameter);
    }
    const result = tracked(input, indexes, parameter);
    if (!result.isOk) return Result.err(result.error);
    return trackEdgeCorner(feature.id, tracking, input, result.value, indexes, parameter);
}

/** Fills the tracking outputs from the corner's kernel history (see `trackedIds`). */
function trackEdgeCorner(
    featureId: string,
    tracking: ShapeTracking,
    input: IShape,
    result: TrackedShape,
    indexes: readonly number[],
    parameter: number,
): Result<IShape> {
    const completed = completeTrackedHistory([input], result);
    tracking.outputFaceIds = trackedIds(featureId, tracking.inputFaceIds, completed.faceMap);
    tracking.outputEdgeIds = trackedIds(featureId, tracking.inputEdgeIds, completed.edgeMap);
    attributeCornerEdges(input, tracking, result, completed, indexes, parameter);
    return Result.ok(result.shape);
}

/**
 * Names the corner's own new edges by content, in place: the kernel reports the edges it
 * TRIMMED off the input (they keep the input's ids), but nothing derives the surface it
 * builds — the two seam lines and the two end arcs of a fillet (measured on a box: 8 of 24
 * output edges), nor a chamfer's own strips. Those fall to `trackedIds`' positional id,
 * which names "output index n" and silently realigns when a rebuild re-enumerates.
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
 *
 * The attribution is taken only when it is unambiguous: one input edge, at least one inherited
 * face whose id is itself stable, and a candidate id no sibling edge also computes. Anything
 * else keeps its positional id rather than take an id another sub-shape could also claim.
 */
function attributeCornerEdges(
    input: IShape,
    tracking: ShapeTracking,
    result: TrackedShape,
    completed: CompletedTrackedHistory,
    indexes: readonly number[],
    parameter: number,
): void {
    const inputEdges = input.findSubShapes(ShapeTypes.edge) as IEdge[];
    const targets = indexes.flatMap((index) => {
        const edge = inputEdges[index];
        const id = tracking.inputEdgeIds[index];
        return edge === undefined || id === undefined ? [] : [{ edge, id }];
    });
    if (targets.length === 0) return;

    const candidates = new Map<number, string>();
    completed.outputEdges.forEach((edge, outputIndex) => {
        if (completed.edgeMap[outputIndex] >= 0) return;
        try {
            const matches = targets.filter((target) => builtFrom(edge, target.edge, parameter));
            const suffix =
                matches.length === 1
                    ? inheritedFaceSuffix(edge, result.shape, completed.outputFaces, tracking.outputFaceIds)
                    : undefined;
            if (matches.length !== 1 || suffix === undefined) return;
            candidates.set(outputIndex, derivedId(matches[0].id, suffix));
        } catch {
            // A degenerate edge (its kernel queries throw, and the release build turns an OCCT
            // failure into a JS-level throw): no attribution, the positional id stays.
        }
    });

    for (const [index, id] of uncontested(candidates)) {
        tracking.outputEdgeIds[index] = id;
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
 *   the parameter. Such edges keep their positional ids.
 *
 * Distance — not "the projection lands on the line" — is what tells one corner's edges from
 * another's: every filleted edge of a box shares its endpoints' planes, so a looser test
 * matches all four (measured: an arc matched four input edges).
 */
function builtFrom(edge: IEdge, inputEdge: IEdge, parameter: number): boolean {
    const direction = inputEdge.endPoint().sub(inputEdge.startPoint()).normalize();
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

/** The id of the inherited face(s) this edge borders — undefined when none carries a stable id. */
function inheritedFaceSuffix(
    edge: IEdge,
    shape: IShape,
    outputFaces: readonly IFace[],
    outputFaceIds: readonly string[],
): string | undefined {
    const faces = edge.findAncestor(ShapeTypes.face, shape) as IFace[];
    const ids = faces.flatMap((face) => {
        const index = outputFaces.findIndex((candidate) => candidate.isSame(face));
        const id = index < 0 ? undefined : outputFaceIds[index];
        return id === undefined || isPositionalId(id) ? [] : [id];
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
