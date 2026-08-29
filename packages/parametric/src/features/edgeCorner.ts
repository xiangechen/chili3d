// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, type IShape, Result } from "@chili3d/core";
import { matchEdgeIndexes } from "./edgeRef";
import { resolveNumber } from "./expression";
import {
    type ChamferFeatureData,
    type FeatureContext,
    type FeatureHandler,
    type FilletFeatureData,
    registerFeature,
} from "./feature";

interface EdgeCornerOptions<F extends FilletFeatureData | ChamferFeatureData> {
    readonly display: I18nKeys;
    readonly icon: string;
    readonly method: "fillet" | "chamfer";
    readonly parameterKey: keyof F & string;
    readonly parameterDisplay: I18nKeys;
}

/**
 * Shared handler for edge-modifying features (fillet/chamfer): edge references are
 * geometric fingerprints re-matched against the rebuilt input on every evaluation,
 * because shape indices drift when upstream features regenerate.
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

        evaluate(feature, context: FeatureContext): Result<IShape> {
            if (context.input === undefined) {
                return Result.err(`${feature.type} requires a preceding feature`);
            }
            const parameter = resolveNumber(feature[options.parameterKey] as number | string, context.scope);
            if (!parameter.isOk) return Result.err(parameter.error);
            const indexes = matchEdgeIndexes(context.input, feature.edges);
            if (!indexes.isOk) return Result.err(indexes.error);
            return shapeFactory[options.method](context.input, indexes.value, parameter.value);
        },
    };
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
