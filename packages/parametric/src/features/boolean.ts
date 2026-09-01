// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    type IShapeFactory,
    Matrix4,
    Result,
    ShapeNode,
    ShapeTypes,
    type TrackedShape,
} from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";
import {
    type BooleanFeatureData,
    type BooleanOperation,
    type FeatureContext,
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

    parameters: (feature) => [
        { key: "consumeTools", display: "features.consumeTools", value: feature.consumeTools ?? true },
    ],

    setParameter: (feature, key, value) =>
        key === "consumeTools" ? { ...feature, consumeTools: value === true || value === "true" } : feature,

    evaluate(feature, context): Result<IShape> {
        if (context.input === undefined) {
            return Result.err("boolean requires a preceding feature");
        }
        const tools = collectTools(feature, context.document);
        if (!tools.isOk) return Result.err(tools.error);
        const tracked = TRACKED[feature.operation](shapeFactory);
        const toolShapes = toolShapesInHostSpace(tools.value, context.host);
        // `transformedMul` copies are intermediate inputs — the kernel reads them
        // eagerly, so dispose them once the operation returns.
        const owned = toolShapes.filter((x, i) => x !== tools.value[i].shape.unchecked());
        try {
            if (context.tracking !== undefined && tracked !== undefined) {
                return evaluateTracked(feature, context, tools.value, toolShapes, tracked);
            }
            switch (feature.operation) {
                case "common":
                    return shapeFactory.booleanCommon([context.input], toolShapes);
                case "cut":
                    return shapeFactory.booleanCut([context.input], toolShapes);
                default:
                    return shapeFactory.booleanFuse([context.input], toolShapes, true);
            }
        } finally {
            owned.forEach((x) => x.dispose());
        }
    },
};

/**
 * Tools live anywhere in the scene, but the boolean runs in the host body's local
 * space (the result renders under the host's own transform), so map each tool
 * shape by hostWorld⁻¹ · toolWorld — a moved copy cuts where it is displayed, not
 * where its shape was generated. Identity mappings reuse the raw shape.
 */
function toolShapesInHostSpace(tools: ShapeNode[], host: ShapeNode): IShape[] {
    const hostInvert = host.worldTransform().invert();
    if (hostInvert === undefined) return tools.map((x) => x.shape.unchecked()!);
    const identity = Matrix4.identity();
    return tools.map((node) => {
        const shape = node.shape.unchecked()!;
        const matrix = hostInvert.multiply(node.worldTransform());
        return matrix.equals(identity) ? shape : shape.transformedMul(matrix);
    });
}

function collectTools(feature: BooleanFeatureData, document: IDocument): Result<ShapeNode[]> {
    const tools: ShapeNode[] = [];
    for (const id of feature.toolIds) {
        const node = document.modelManager.findNode((n) => n.id === id);
        if (!(node instanceof ShapeNode)) return Result.err("Boolean tool not found");
        if (!node.shape.isOk) return Result.err("Boolean tool has no shape");
        tools.push(node);
    }
    return Result.ok(tools);
}

const TRACKED: Record<BooleanOperation, (factory: IShapeFactory) => TrackedMethod | undefined> = {
    common: (factory) => factory.booleanCommonTracked?.bind(factory),
    cut: (factory) => factory.booleanCutTracked?.bind(factory),
    fuse: (factory) => factory.booleanFuseTracked?.bind(factory),
};

type TrackedMethod = (shape1: IShape[], shape2: IShape[]) => Result<TrackedShape>;

function evaluateTracked(
    feature: BooleanFeatureData,
    context: FeatureContext,
    tools: ShapeNode[],
    toolShapes: IShape[],
    tracked: TrackedMethod,
): Result<IShape> {
    const result = tracked([context.input!], toolShapes);
    if (!result.isOk) return Result.err(result.error);
    const tracking = context.tracking!;
    tracking.outputFaceIds = mapBooleanIds(
        feature,
        context.input!,
        tracking.inputFaceIds,
        tools,
        result.value.faceMap,
        ShapeTypes.face,
    );
    tracking.outputEdgeIds = mapBooleanIds(
        feature,
        context.input!,
        tracking.inputEdgeIds,
        tools,
        result.value.edgeMap,
        ShapeTypes.edge,
    );
    return Result.ok(result.value.shape);
}

/**
 * Maps boolean history to stable ids. The kernel enumerates the main body's sub-shapes
 * first, then each tool's in order: main-body hits keep their id, tool hits inherit the
 * tool's own tracked id (parametric tools) or a tool-scoped positional id, and
 * boolean-born sub-shapes (e.g. intersection edges) get feature-scoped ids.
 * The main/tool boundary is the tracked-id count when available, else the input
 * shape's own sub-shape count: when upstream tracking was lost (`inputIds` empty),
 * main-body sub-shapes would otherwise leak into the tool ranges and get bogus
 * tool ids.
 */
function mapBooleanIds(
    feature: BooleanFeatureData,
    input: IShape,
    inputIds: readonly string[],
    tools: ShapeNode[],
    map: number[],
    type: (typeof ShapeTypes)["face" | "edge"],
): string[] {
    // The boundary is the tracked-id count when available, else the input shape's
    // own sub-shape count (upstream tracking lost): without it, main-body sub-shapes
    // would leak into the tool ranges and get bogus tool ids.
    const mainCount = Math.max(inputIds.length, input.findSubShapes(type).length);
    let start = mainCount;
    const ranges = tools.map((node) => {
        const count = node.shape.unchecked()!.findSubShapes(type).length;
        const range = { node, start, count };
        start += count;
        return range;
    });
    return map.map((inputIndex, outputIndex) => {
        if (inputIndex >= 0 && inputIndex < inputIds.length) return inputIds[inputIndex];
        // Untracked main-body hit or boolean-born sub-shape: stable feature-scoped id.
        if (inputIndex < mainCount) return `${feature.id}:${outputIndex}`;
        const range = ranges.find((x) => inputIndex >= x.start && inputIndex < x.start + x.count);
        if (range === undefined) return `${feature.id}:${outputIndex}`;
        const local = inputIndex - range.start;
        const toolId =
            range.node instanceof ParametricBodyNode
                ? type === ShapeTypes.face
                    ? range.node.faceIdAt(local)
                    : range.node.edgeIdAt(local)
                : undefined;
        return `tool:${range.node.id}:${toolId ?? local}`;
    });
}

registerFeature("boolean", booleanHandler);
