// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, type IShape, Result, ShapeNode } from "@chili3d/core";
import {
    type BooleanFeatureData,
    type BooleanOperation,
    type FeatureHandler,
    registerFeature,
} from "./feature";

const DISPLAYS: Record<BooleanOperation, I18nKeys> = {
    fuse: "command.feature.fuse",
    cut: "command.feature.cut",
    common: "command.feature.common",
};

const ICONS: Record<BooleanOperation, string> = {
    fuse: "icon-booleanFuse",
    cut: "icon-booleanCut",
    common: "icon-booleanCommon",
};

const booleanHandler: FeatureHandler<BooleanFeatureData> = {
    display: (feature) => DISPLAYS[feature.operation],
    icon: (feature) => ICONS[feature.operation],

    nodeIds: (feature) => feature.toolIds,

    parameters: () => [],

    setParameter: (feature) => feature,

    evaluate(feature, context): Result<IShape> {
        if (context.input === undefined) {
            return Result.err("boolean requires a preceding feature");
        }
        const tools: IShape[] = [];
        for (const id of feature.toolIds) {
            const node = context.document.modelManager.findNode((n) => n.id === id);
            if (!(node instanceof ShapeNode)) return Result.err("Boolean tool not found");
            if (!node.shape.isOk) return Result.err("Boolean tool has no shape");
            tools.push(node.shape.value);
        }
        switch (feature.operation) {
            case "common":
                return shapeFactory.booleanCommon([context.input], tools);
            case "cut":
                return shapeFactory.booleanCut([context.input], tools);
            default:
                return shapeFactory.booleanFuse([context.input], tools, true);
        }
    },
};

registerFeature("boolean", booleanHandler);
