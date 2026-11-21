// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type INode,
    type IShape,
    type IShapeFactory,
    isInstanceNode,
    Matrix4,
    Result,
    ShapeNode,
    ShapeTypes,
    type TrackedShape,
} from "@chili3d/core";
import { type IBodyTimelineNode, isBodyTimelineNode } from "./bodyTracking";
import {
    type BooleanFeatureData,
    type BooleanOperation,
    completeTrackedHistory,
    type FeatureContext,
    type FeatureHandler,
    type IShapeHost,
    registerFeature,
    trackedAncestors,
} from "./feature";
import { type BooleanToolInput, bornEdgeIdMap, mapBooleanIds } from "./operationIds";

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
        const collected = collectTools(feature, context.document);
        if (!collected.isOk) return Result.err(collected.error);
        const { tools, missing } = collected.value;
        if (missing.length > 0 && context.tracking !== undefined) {
            // The tools that are still there are what the user can see; combining them
            // and naming the ones that went beats refusing the whole boolean, which
            // would leave the row with nothing to re-pick either.
            context.tracking.unresolved = { key: "toolIds", refIndexes: missing };
        }
        const tracked = TRACKED[feature.operation](shapeFactory);
        const toolShapes = toolShapesInHostSpace(tools, context.host);
        // `transformedMul` copies are intermediate inputs — the kernel reads them
        // eagerly, so dispose them once the operation returns.
        const owned = toolShapes.filter((shape, index) => shape !== tools[index].shape);
        try {
            if (context.tracking !== undefined && tracked !== undefined) {
                return evaluateTracked(context, tools, toolShapes, tracked);
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
function toolShapesInHostSpace(tools: readonly BooleanToolInput[], host: IShapeHost): IShape[] {
    const hostInvert = host.worldTransform().invert();
    if (hostInvert === undefined) return tools.map((tool) => tool.shape);
    const identity = Matrix4.identity();
    return tools.map((tool) => {
        const matrix = hostInvert.multiply(tool.node.worldTransform());
        return matrix.equals(identity) ? tool.shape : tool.shape.transformedMul(matrix);
    });
}

/**
 * Captures every tool's current timeline position, rejecting a tool whose visible prefix is
 * empty. Like sketch external refs, a capture during a rollback session intentionally records
 * the visible preview position, including when the caller is an AI/bridge program.
 */
export function captureBooleanToolFeatureCounts(tools: readonly INode[]): Result<(number | null)[]> {
    const counts: (number | null)[] = [];
    for (const node of tools) {
        if (!(node instanceof ShapeNode) || !node.shape.isOk) {
            return Result.err("Boolean tool has no shape");
        }
        const timeline = booleanToolTimeline(node);
        if (timeline === undefined) {
            counts.push(null);
            continue;
        }
        const position = timeline.evaluationStopIndex();
        if (timeline.timelineStateAfter(position)?.shape === undefined) {
            return Result.err("Boolean tool has no shape");
        }
        counts.push(position);
    }
    return Result.ok(counts);
}

function booleanToolTimeline(node: INode): IBodyTimelineNode | undefined {
    const seen = new Set<string>();
    let current: INode | undefined = node;
    while (current !== undefined && !seen.has(current.id)) {
        seen.add(current.id);
        if (isBodyTimelineNode(current)) return current;
        current = isInstanceNode(current) ? current.source : undefined;
    }
    return undefined;
}

/**
 * Resolves the selected node to the exact shape and ids its captured timeline position names.
 * An instance retarget keeps the ordinal anchor and interprets it against the NEW source's
 * chain (clamped when shorter); it does not preserve the old source's timeline.
 */
export function resolveBooleanTool(
    feature: BooleanFeatureData,
    index: number,
    node: ShapeNode,
): Result<BooleanToolInput> {
    const current = node.shape;
    const timeline = booleanToolTimeline(node);
    if (timeline === undefined) {
        return current.isOk
            ? Result.ok({ node, shape: current.value })
            : Result.err("Boolean tool has no shape");
    }
    const captured = feature.toolFeatureCounts?.[index];
    const position = typeof captured === "number" ? captured : timeline.evaluationStopIndex();
    const state = timeline.timelineStateAfter(position);
    if (state?.shape === undefined) return Result.err("Boolean tool has no shape");
    // A feature AFTER the captured position may fail without invalidating the prefix this
    // boolean actually reads. An unanchored tool keeps the old failure behavior.
    if (typeof captured !== "number" && !current.isOk) return Result.err("Boolean tool has no shape");
    return Result.ok({ node, ...state, shape: state.shape });
}

/**
 * The tool bodies that still resolve, plus the positions in `toolIds` whose node has
 * gone. A deleted tool is a pick the user can put back; a tool that is PRESENT but has
 * no shape yet is a chain that has not finished, and the caller is told to wait rather
 * than combine what happens to be there.
 */
function collectTools(
    feature: BooleanFeatureData,
    document: IDocument,
): Result<{ tools: BooleanToolInput[]; missing: number[] }> {
    const tools: BooleanToolInput[] = [];
    const missing: number[] = [];
    for (const [index, id] of feature.toolIds.entries()) {
        const node = document.modelManager.findNode((n) => n.id === id);
        if (!(node instanceof ShapeNode)) {
            missing.push(index);
            continue;
        }
        const tool = resolveBooleanTool(feature, index, node);
        if (!tool.isOk) return Result.err(tool.error);
        tools.push(tool.value);
    }
    if (tools.length === 0) return Result.err("Boolean tool not found");
    return Result.ok({ tools, missing });
}

const TRACKED: Record<BooleanOperation, (factory: IShapeFactory) => TrackedMethod | undefined> = {
    common: (factory) => factory.booleanCommonTracked?.bind(factory),
    cut: (factory) => factory.booleanCutTracked?.bind(factory),
    fuse: (factory) => factory.booleanFuseTracked?.bind(factory),
};

export type TrackedMethod = (shape1: IShape[], shape2: IShape[]) => Result<TrackedShape>;

/** The kernel's history-tracking variant of a boolean operation, when available. */
export function trackedBoolean(operation: BooleanOperation): TrackedMethod | undefined {
    return TRACKED[operation](shapeFactory);
}

function evaluateTracked(
    context: FeatureContext,
    tools: readonly BooleanToolInput[],
    toolShapes: IShape[],
    tracked: TrackedMethod,
): Result<IShape> {
    const { input, tracking } = context;
    // Both are guaranteed by the caller's guards — the type just cannot see it.
    if (input === undefined || tracking === undefined) {
        return Result.err("boolean requires a preceding feature");
    }
    const result = tracked([input], toolShapes);
    if (!result.isOk) return Result.err(result.error);
    const completed = completeTrackedHistory([input, ...toolShapes], result.value);
    const { outputEdges, outputFaces } = completed;
    // Both mappers below consume the merge channel, so this is one of the few places that pays
    // for verifying it (see `trackedAncestors`).
    const ancestors = trackedAncestors(completed, result.value);
    tracking.outputFaceIds = mapBooleanIds(
        input,
        tracking.inputFaceIds,
        tools,
        completed.faceMap,
        ShapeTypes.face,
        ancestors.faceAncestors,
    );
    // The intersection curves this boolean carved derive from nothing in either operand;
    // they are named by the two faces they join (see `bornEdgeIdMap`).
    const bornEdges = bornEdgeIdMap(
        result.value.shape,
        outputEdges,
        outputFaces,
        tracking.outputFaceIds,
        (index) => completed.edgeMap[index] < 0,
    );
    tracking.outputEdgeIds = mapBooleanIds(
        input,
        tracking.inputEdgeIds,
        tools,
        completed.edgeMap,
        ShapeTypes.edge,
        ancestors.edgeAncestors,
        (index) => bornEdges.get(index),
    );
    return Result.ok(result.value.shape);
}

registerFeature("boolean", booleanHandler);
