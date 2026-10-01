// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IShape, LENGTH_UNITS, Result, resolveUnitSpec, type XYZ } from "@chili3d/core";
import { SketchNode } from "../sketch/sketchNode";
import { trackedBoolean } from "./boolean";
import {
    completeTrackedHistory,
    type ExtrudeFeatureData,
    type FeatureContext,
    type FeatureHandler,
    registerFeature,
    type ShapeTracking,
} from "./feature";
import { applyTrackedOperation, trackOperation } from "./operation";
import { extrudeFromSourceFaces } from "./pressPull";
import { type ResolvedProfile, resolveProfiles } from "./profileBuilder";
import { captureProfileRef } from "./profileRef";
import { combineShapes, extrudePlain } from "./sweepGeometry";
import { fuseSweptPrisms, sweepFaceTracked } from "./sweepTracked";

export function findSketch(document: IDocument, id: string): SketchNode | undefined {
    const node = document.modelManager.findNode((n) => n.id === id);
    return node instanceof SketchNode ? node : undefined;
}

const extrudeHandler: FeatureHandler<ExtrudeFeatureData> = {
    display: "command.feature.extrude",
    icon: "icon-prism",
    reselectable: true,

    nodeIds: (feature) =>
        [feature.sketchId, feature.source?.nodeId].filter((x): x is string => x !== undefined),

    // Only the sketch: `source` is the body being press-pulled, which the tree
    // already shows and the feature row does not need a second door to.
    references: (feature) =>
        feature.sketchId === undefined
            ? []
            : [{ key: "sketchId", display: "body.sketch", nodeId: feature.sketchId }],

    parameters: (feature) => [
        { key: "depth", display: "option.command.depth", value: feature.depth, unit: LENGTH_UNITS },
        {
            key: "startOffset",
            display: "option.command.startOffset",
            value: feature.startOffset ?? 0,
            unit: LENGTH_UNITS,
        },
        { key: "symmetric", display: "option.command.symmetric", value: feature.symmetric ?? false },
    ],

    setParameter: (feature, key, value) =>
        key === "symmetric"
            ? { ...feature, symmetric: value === true || value === "true" }
            : { ...feature, [key]: value },

    applyResolvedRefs: (feature, { resolvedProfiles }) =>
        resolvedProfiles === undefined
            ? feature
            : feature.source === undefined
              ? { ...feature, profiles: resolvedProfiles }
              : { ...feature, source: { ...feature.source, profiles: resolvedProfiles } },

    evaluate(feature, context): Result<IShape> {
        const params = resolveExtrudeParams(feature, context);
        if (!params.isOk) return Result.err(params.error);
        const { depth, startOffset } = params.value;

        const tracked = evaluateOperationTracked(feature, context, depth, startOffset);
        if (tracked !== undefined) return tracked;

        const source = feature.source;
        if (source === undefined) {
            return combineWithInput(
                extrudeFromSketch(feature, context, depth, startOffset),
                feature,
                context,
            );
        }
        const built = extrudeFromSourceFaces({ ...feature, source }, context, depth, startOffset);
        if (!built.isOk) return Result.err(built.error);
        // The sweep's ids are the body's ids — without this a standalone press-pull (the default:
        // no `operation`) named nothing (see `extrudeTracked`, the sketch path's counterpart).
        if (context.tracking !== undefined) {
            context.tracking.outputFaceIds = built.value.faceIds;
            context.tracking.outputEdgeIds = built.value.edgeIds;
        }
        return combineWithInput(Result.ok(built.value.shape), feature, context);
    },
};

/** Resolves the numeric parameters first, so a bad expression fails before any geometry runs. */
function resolveExtrudeParams(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
): Result<{ depth: number; startOffset: number }> {
    const depth = resolveUnitSpec(feature.depth, context.scope, LENGTH_UNITS);
    if (!depth.isOk) return Result.err(depth.error);
    const startOffset = resolveUnitSpec(feature.startOffset ?? 0, context.scope, LENGTH_UNITS);
    if (!startOffset.isOk) return Result.err(startOffset.error);
    return Result.ok({ depth: depth.value, startOffset: startOffset.value });
}

/**
 * Join/cut/intersect takes the tracked path, so downstream edge refs keep stable ids
 * through the boolean: sketch profiles via `extrudeOperationTracked`, and press-pulled
 * faces via `pressPullOperationTracked` so the body's own face ids survive past this
 * feature and later press-pulls still resolve by id. Returns undefined when no
 * operation was asked for, or when a tracking capability is missing.
 */
function evaluateOperationTracked(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    depth: number,
    startOffset: number,
): Result<IShape> | undefined {
    if (feature.operation === undefined) return undefined;
    const source = feature.source;
    return source === undefined
        ? extrudeOperationTracked(feature, context, depth, startOffset)
        : pressPullOperationTracked({ ...feature, source }, context, depth, startOffset);
}

/** Combines the freshly built prism with the chain input, when an operation was asked for. */
function combineWithInput(
    built: Result<IShape>,
    feature: ExtrudeFeatureData,
    context: FeatureContext,
): Result<IShape> {
    if (!built.isOk || feature.operation === undefined) return built;
    if (context.input === undefined) {
        built.value.dispose();
        return Result.err("Extrude join/cut/intersect requires a preceding feature");
    }
    try {
        switch (feature.operation) {
            case "cut":
                return shapeFactory.booleanCut([context.input], [built.value]);
            case "common":
                return shapeFactory.booleanCommon([context.input], [built.value]);
            default:
                return shapeFactory.booleanFuse([context.input], [built.value], true);
        }
    } finally {
        // The prism is an intermediate input — the kernel reads it eagerly.
        built.value.dispose();
    }
}

/** Extrudes the referenced sketch profiles (the classic path). */
function extrudeFromSketch(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    depth: number,
    startOffset: number,
): Result<IShape> {
    const resolved = resolveSketchProfiles(feature, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { sketch, profiles } = resolved.value;
    const vec = sketch.plane.normal.multiply(depth);
    const vecs = feature.symmetric === true ? [vec, vec.multiply(-1)] : [vec];
    const offsetVec = sketch.plane.normal.multiply(startOffset);

    // An operation with unavailable tracking falls back to the plain path — downstream
    // edge fingerprints then re-match geometrically after a rebuild.
    const plain =
        feature.operation !== undefined ||
        context.tracking === undefined ||
        shapeFactory.prismTracked === undefined;
    return plain
        ? extrudePlain(profiles, vecs, offsetVec)
        : extrudeTracked(sketch, vecs, profiles, context.tracking!, offsetVec);
}

/**
 * Resolves the feature's sketch and the profiles to extrude, re-anchoring the stored
 * fingerprints on the geometry matched this run (see `ShapeTracking.resolvedProfiles`)
 * so the next edit measures drift from here.
 */
function resolveSketchProfiles(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
): Result<{ sketch: SketchNode; profiles: ResolvedProfile[] }> {
    const sketch =
        feature.sketchId === undefined ? undefined : findSketch(context.document, feature.sketchId);
    if (sketch === undefined) return Result.err("Sketch not found");

    const profiles = resolveProfiles(sketch, feature.profiles);
    if (!profiles.isOk) return Result.err(profiles.error);
    if (feature.profiles !== undefined && feature.profiles.length > 0 && context.tracking !== undefined) {
        context.tracking.resolvedProfiles = profiles.value.map(({ face }) => captureProfileRef(face));
    }
    return Result.ok({ sketch, profiles: profiles.value });
}

function extrudeTracked(
    sketch: SketchNode,
    vecs: XYZ[],
    profiles: ResolvedProfile[],
    tracking: ShapeTracking,
    offsetVec: XYZ,
): Result<IShape> {
    const swept = sweepProfiles(sketch, vecs, profiles, offsetVec);
    if (!swept.isOk) return Result.err(swept.error);
    tracking.outputFaceIds = swept.value.faceIds;
    tracking.outputEdgeIds = swept.value.edgeIds;
    return Result.ok(swept.value.shape);
}

/**
 * Sweeps every profile along each direction with kernel history (sketch-scoped ids)
 * and merges touching prisms, returning the shape with its tracked ids in
 * findSubShapes order.
 */
function sweepProfiles(
    sketch: SketchNode,
    vecs: XYZ[],
    profiles: ResolvedProfile[],
    offsetVec: XYZ,
): Result<{ shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] }> {
    const shapes: IShape[] = [];
    const faceIds: (string | undefined)[][] = [];
    const edgeIds: (string | undefined)[][] = [];
    for (const profile of profiles) {
        for (const [direction, vec] of vecs.entries()) {
            const swept = sweepFaceTracked(
                profile.face,
                `sketch:${sketch.id}:${profile.seed}`,
                vec,
                offsetVec,
                direction === 0 ? "" : ":neg",
            );
            if (!swept.isOk) return Result.err(swept.error);
            shapes.push(swept.value.shape);
            faceIds.push(swept.value.faceIds);
            edgeIds.push(swept.value.edgeIds);
        }
    }
    const fused = fuseSweptPrisms(shapes, faceIds, edgeIds);
    if (fused !== undefined) return fused;
    const combined = combineShapes(shapes);
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({ shape: combined.value, faceIds: faceIds.flat(), edgeIds: edgeIds.flat() });
}

/**
 * Press-pull with join/cut/intersect on the tracked path: the swept prism combines
 * with the chain input via the tracked boolean, so the body's own face ids survive
 * past this feature and later press-pulls still resolve by id — including on the pad
 * this feature raises, whose top is the pressed face's own image (`sweepTracked.ts`).
 * Returns undefined when a tracking capability is missing (the caller falls back to
 * the plain path).
 */
function pressPullOperationTracked(
    feature: ExtrudeFeatureData & { source: NonNullable<ExtrudeFeatureData["source"]> },
    context: FeatureContext,
    depth: number,
    startOffset: number,
): Result<IShape> | undefined {
    const tracking = context.tracking;
    const tracked = feature.operation === undefined ? undefined : trackedBoolean(feature.operation);
    if (tracking === undefined || tracked === undefined) return undefined;
    if (context.input === undefined) {
        return Result.err("Extrude join/cut/intersect requires a preceding feature");
    }
    const built = extrudeFromSourceFaces(feature, context, depth, startOffset);
    if (!built.isOk) return Result.err(built.error);
    try {
        const result = tracked([context.input], [built.value.shape]);
        if (!result.isOk) return Result.err(result.error);
        // Empty when the source face carried no id — an untracked tool, not a misnamed one.
        const tool = { faceIds: built.value.faceIds, edgeIds: built.value.edgeIds };
        const completed = completeTrackedHistory([context.input, built.value.shape], result.value);
        trackOperation(context.input, tracking, tool, completed, result.value);
        return Result.ok(result.value.shape);
    } finally {
        // The prism is an intermediate input — the kernel reads it eagerly.
        built.value.shape.dispose();
    }
}

/**
 * Join/cut/intersect on the tracked path: profiles are swept with kernel history
 * (sketch-scoped ids), then combined with the chain input via the tracked boolean —
 * downstream edge refs (fillet/chamfer) keep their stable ids across rebuilds instead
 * of re-matching geometrically, where a large sketch edit strands them between
 * look-alike candidates. Returns undefined when a tracking capability is missing
 * (the caller falls back to the plain path).
 */
function extrudeOperationTracked(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    depth: number,
    startOffset: number,
): Result<IShape> | undefined {
    const tracking = context.tracking;
    const tracked = trackedBoolean(feature.operation!);
    if (tracking === undefined || tracked === undefined || shapeFactory.prismTracked === undefined) {
        return undefined;
    }
    const input = context.input;
    if (input === undefined) {
        return Result.err("Extrude join/cut/intersect requires a preceding feature");
    }
    const resolved = resolveSketchProfiles(feature, context);
    if (!resolved.isOk) return Result.err(resolved.error);

    const vec = resolved.value.sketch.plane.normal.multiply(depth);
    const vecs = feature.symmetric === true ? [vec, vec.multiply(-1)] : [vec];
    const offsetVec = resolved.value.sketch.plane.normal.multiply(startOffset);
    const tool = sweepProfiles(resolved.value.sketch, vecs, resolved.value.profiles, offsetVec);
    if (!tool.isOk) return Result.err(tool.error);
    try {
        return applyTrackedOperation(input, tracking, tracked, tool.value);
    } finally {
        // The prism is an intermediate input — the kernel reads it eagerly.
        tool.value.shape.dispose();
    }
}

registerFeature("extrude", extrudeHandler);
