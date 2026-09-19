// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IShape,
    LENGTH_UNITS,
    Result,
    resolveUnitSpec,
    type Scope,
    type TrackedShape,
} from "@chili3d/core";
import { matchEdgeIndexes, matchEdgesAnchored } from "./edgeMatcher";
import {
    type ChamferFeatureData,
    completeTrackedHistory,
    type FeatureContext,
    type FeatureHandler,
    type FilletFeatureData,
    registerFeature,
    type ShapeTracking,
    trackedIds,
} from "./feature";

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
    return trackEdgeCorner(feature.id, tracking, input, result.value);
}

/** Fills the tracking outputs from the corner's kernel history (see `trackedIds`). */
function trackEdgeCorner(
    featureId: string,
    tracking: ShapeTracking,
    input: IShape,
    result: TrackedShape,
): Result<IShape> {
    const { edgeMap, faceMap } = completeTrackedHistory([input], result);
    tracking.outputFaceIds = trackedIds(featureId, tracking.inputFaceIds, faceMap);
    tracking.outputEdgeIds = trackedIds(featureId, tracking.inputEdgeIds, edgeMap);
    return Result.ok(result.shape);
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
