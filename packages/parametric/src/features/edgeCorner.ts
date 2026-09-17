// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, type IShape, Result, type TrackedShape } from "@chili3d/core";
import { matchEdgeIndexes, matchEdgesAnchored } from "./edgeRef";
import { resolveNumber } from "./expression";
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
            },
        ],

        setParameter: (feature, key, value) => ({ ...feature, [key]: value }),

        applyResolvedRefs: (feature, { resolvedEdges }) =>
            resolvedEdges === undefined ? feature : { ...feature, edges: resolvedEdges },

        evaluate(feature, context: FeatureContext): Result<IShape> {
            if (context.input === undefined) {
                return Result.err(`${feature.type} requires a preceding feature`);
            }
            const parameter = resolveNumber(feature[options.parameterKey] as number | string, context.scope);
            if (!parameter.isOk) return Result.err(parameter.error);
            const tracking = context.tracking;
            let indexes: number[];
            if (tracking === undefined) {
                const matched = matchEdgeIndexes(context.input, feature.edges);
                if (!matched.isOk) return Result.err(matched.error);
                indexes = matched.value;
            } else {
                const matched = matchEdgesAnchored(context.input, feature.edges, tracking.inputEdgeIds);
                if (!matched.isOk) return Result.err(matched.error);
                indexes = matched.value.indexes;
                // Re-anchored refs for the body's write-back (see ShapeTracking.resolvedEdges).
                tracking.resolvedEdges = matched.value.anchors;
            }
            const tracked =
                options.method === "fillet" ? shapeFactory.filletTracked : shapeFactory.chamferTracked;
            if (tracking === undefined || tracked === undefined) {
                return shapeFactory[options.method](context.input, indexes, parameter.value);
            }
            const result = tracked(context.input, indexes, parameter.value);
            if (!result.isOk) return Result.err(result.error);
            return trackEdgeCorner(feature.id, tracking, context.input, result.value);
        },
    };
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
