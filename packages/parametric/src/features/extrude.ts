// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IDocument,
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
import { SketchNode } from "../sketch/sketchNode";
import { type TrackedMethod, trackedBoolean } from "./boolean";
import {
    completeTrackedHistory,
    type ExtrudeFeatureData,
    type FeatureContext,
    type FeatureHandler,
    registerFeature,
    type ShapeTracking,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { mapFusedIds, mapOperationIds } from "./operationIds";
import { extrudeFromSourceFaces } from "./pressPull";
import { type ResolvedProfile, resolveProfiles } from "./profileBuilder";
import { profileEdgeEntityIds, registerProfileEdgeEntities } from "./profileEntities";
import { captureProfileRef } from "./profileRef";
import { profileEdgeSeeds } from "./profileSeeds";
import { anyPairTouches, combineShapes, extrudePlain, translateFace } from "./sweepGeometry";

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
        const built =
            source === undefined
                ? extrudeFromSketch(feature, context, depth, startOffset)
                : extrudeFromSourceFaces({ ...feature, source }, context, depth, startOffset);
        return combineWithInput(built, feature, context);
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
        : extrudeTracked(feature, sketch, vecs, profiles, context.tracking!, offsetVec);
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
    feature: ExtrudeFeatureData,
    sketch: SketchNode,
    vecs: XYZ[],
    profiles: ResolvedProfile[],
    tracking: ShapeTracking,
    offsetVec: XYZ,
): Result<IShape> {
    const swept = sweepProfiles(feature, sketch, vecs, profiles, offsetVec);
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
    feature: ExtrudeFeatureData,
    sketch: SketchNode,
    vecs: XYZ[],
    profiles: ResolvedProfile[],
    offsetVec: XYZ,
): Result<{ shape: IShape; faceIds: string[]; edgeIds: string[] }> {
    const shapes: IShape[] = [];
    const faceIds: string[][] = [];
    const edgeIds: string[][] = [];
    for (const profile of profiles) {
        for (const [direction, vec] of vecs.entries()) {
            const swept = sweepProfileTracked(
                feature,
                sketch,
                vec,
                profile,
                offsetVec,
                direction === 0 ? "" : ":neg",
            );
            if (!swept.isOk) return Result.err(swept.error);
            shapes.push(swept.value.shape);
            faceIds.push(swept.value.faceIds);
            edgeIds.push(swept.value.edgeIds);
        }
    }
    const fused = fuseSweptPrisms(feature.id, shapes, faceIds, edgeIds);
    if (fused !== undefined) return fused;
    const combined = combineShapes(shapes);
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({ shape: combined.value, faceIds: faceIds.flat(), edgeIds: edgeIds.flat() });
}

/**
 * Fuses touching swept prisms into one solid with kernel history, mapping the
 * merged ids back per prism. Returns undefined when the fuse does not apply or
 * fails — the caller then combines the prisms into a compound.
 */
function fuseSweptPrisms(
    featureId: string,
    shapes: IShape[],
    faceIds: string[][],
    edgeIds: string[][],
): Result<{ shape: IShape; faceIds: string[]; edgeIds: string[] }> | undefined {
    if (shapes.length <= 1 || !anyPairTouches(shapes) || shapeFactory.booleanFuseTracked === undefined) {
        return undefined;
    }
    const fused = shapeFactory.booleanFuseTracked([shapes[0]], shapes.slice(1));
    if (!fused.isOk) return undefined;
    const { edgeMap, faceMap } = completeTrackedHistory(shapes, fused.value);
    const merged = {
        shape: fused.value.shape,
        faceIds: mapFusedIds(featureId, faceIds, faceMap),
        edgeIds: mapFusedIds(featureId, edgeIds, edgeMap),
    };
    shapes.forEach((x) => {
        x.dispose();
    });
    return Result.ok(merged);
}

/**
 * Press-pull with join/cut/intersect on the tracked path: the swept prism combines
 * with the chain input via the tracked boolean, so the body's own face ids survive
 * past this feature and later press-pulls still resolve by id. The tool's sub-shapes
 * get positional feature-scoped ids — the sweep is deterministic per source-face set,
 * and its faces are new geometry either way (they realign when the source-face set
 * changes, the usual feature-scoped trade-off). Returns undefined when a tracking
 * capability is missing (the caller falls back to the plain path).
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
        const result = tracked([context.input], [built.value]);
        if (!result.isOk) return Result.err(result.error);
        const tool = {
            faceIds: (built.value.findSubShapes(ShapeTypes.face) as IFace[]).map(
                (_, index) => `${feature.id}:tool:f${index}`,
            ),
            edgeIds: (built.value.findSubShapes(ShapeTypes.edge) as IEdge[]).map(
                (_, index) => `${feature.id}:tool:e${index}`,
            ),
        };
        const { edgeMap, faceMap } = completeTrackedHistory([context.input, built.value], result.value);
        trackOperation(feature.id, context.input, tracking, tool, { ...result.value, edgeMap, faceMap });
        return Result.ok(result.value.shape);
    } finally {
        // The prism is an intermediate input — the kernel reads it eagerly.
        built.value.dispose();
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
    const tool = sweepProfiles(feature, resolved.value.sketch, vecs, resolved.value.profiles, offsetVec);
    if (!tool.isOk) return Result.err(tool.error);
    try {
        return applyTrackedOperation(feature.id, input, tracking, tracked, tool.value);
    } finally {
        // The prism is an intermediate input — the kernel reads it eagerly.
        tool.value.shape.dispose();
    }
}

/** Combines the swept prism with the chain input and records the resulting id map. */
function applyTrackedOperation(
    featureId: string,
    input: IShape,
    tracking: ShapeTracking,
    tracked: TrackedMethod,
    tool: { shape: IShape; faceIds: string[]; edgeIds: string[] },
): Result<IShape> {
    const result = tracked([input], [tool.shape]);
    if (!result.isOk) return Result.err(result.error);

    const { edgeMap, faceMap } = completeTrackedHistory([input, tool.shape], result.value);
    trackOperation(featureId, input, tracking, tool, { ...result.value, edgeMap, faceMap });
    return Result.ok(result.value.shape);
}

/** Fills the tracking outputs from the operation's boolean history (see `mapOperationIds`). */
function trackOperation(
    featureId: string,
    input: IShape,
    tracking: ShapeTracking,
    tool: { faceIds: string[]; edgeIds: string[] },
    result: TrackedShape,
): void {
    tracking.outputFaceIds = mapOperationIds(
        featureId,
        input,
        tracking.inputFaceIds,
        tool.faceIds,
        result.faceMap,
        ShapeTypes.face,
        result.faceAncestors,
    );
    tracking.outputEdgeIds = mapOperationIds(
        featureId,
        input,
        tracking.inputEdgeIds,
        tool.edgeIds,
        result.edgeMap,
        ShapeTypes.edge,
        result.edgeAncestors,
    );
}

/**
 * Sweeps one profile with kernel history and maps that history to stable ids.
 *
 * - **Bottom edges** — the profile's edges seed sketch-scoped ids; the prism's bottom edges are
 *   identical to them.
 * - **Bottom face** — each profile face seeds one id, which prism history propagates to the
 *   bottom face (also identical to the profile).
 * - **Top face** — has no sweep history at all (it is neither the identical bottom nor an
 *   edge-generated side), so the kernel reports it directly through `capFaces` (LastShape) and
 *   it takes the profile's synthetic `:top` seed. A positional feature-scoped id would realign
 *   onto another face when the sketch's structure changes. A kernel predating that channel
 *   falls back to the unique-history-less-face heuristic.
 * - **Side faces** — generated from profile edges, so they take that edge's seed; a rebuild that
 *   re-enumerates faces (a mirrored profile) therefore cannot realign them.
 * - **Anything the sweep history does not cover** gets a feature-scoped id.
 * - **`seedSuffix`** keeps the mirrored half of a symmetric sweep from duplicating the first
 *   half's ids.
 */
function sweepProfileTracked(
    feature: ExtrudeFeatureData,
    sketch: SketchNode,
    vec: XYZ,
    profile: ResolvedProfile,
    offsetVec: XYZ,
    seedSuffix = "",
): Result<{ shape: IShape; faceIds: string[]; edgeIds: string[] }> {
    const owned: IFace[] = [];
    try {
        const face = translateFace(profile.face, offsetVec, owned);
        // A translated copy is a fresh object: it is neither the WeakMap key of the
        // original profile face nor in its sub-shape parent chain, so without
        // re-registering, a start offset would demote every edge seed to a
        // positional ordinal. The translation preserves the edge enumeration.
        if (face !== profile.face) {
            const entities = profileEdgeEntityIds(profile.face);
            if (entities !== undefined) registerProfileEdgeEntities(face, entities);
        }
        const result = shapeFactory.prismTracked!(face, vec);
        if (!result.isOk) return Result.err(result.error);
        const seed = `sketch:${sketch.id}:${profile.seed}${seedSuffix}`;
        const faceEdges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
        // Entity-derived edge seeds survive wire re-enumeration (see profileEdgeSeeds).
        const edgeSeeds = profileEdgeSeeds(face, seed, faceEdges);
        const featureId = `${feature.id}${seedSuffix}`;
        // The completed face map keeps the top-face seeding below unambiguous: a
        // kernel-missed bottom face would otherwise look like a second history-less
        // candidate.
        const { edgeMap, faceMap } = completeTrackedHistory([face], result.value, {
            inputEdges: faceEdges,
            inputFaces: [face],
        });
        const faceIds = trackedFaceIds(featureId, [seed], edgeSeeds, faceMap, result.value.faceEdgeMap);
        // The top face is the profile's other sweep image (see the doc above). The
        // kernel reports it directly (the sweep's LastShape) — authoritative, so the
        // history-less heuristic must not run when a cap is reported (it misidentifies
        // when several faces lack history). The heuristic remains for kernels
        // predating the channel; it seeds only a unique history-less face, so an
        // ambiguous report keeps the positional fallback.
        const reported = result.value.capFaces ?? [];
        if (reported.length > 0) {
            for (const index of reported) {
                if (index >= 0 && index < faceIds.length) faceIds[index] = `${seed}:top`;
            }
        } else {
            const topCandidates = faceIds.flatMap((_, index) =>
                faceMap[index] < 0 && (result.value.faceEdgeMap?.[index] ?? -1) < 0 ? [index] : [],
            );
            if (topCandidates.length === 1) faceIds[topCandidates[0]] = `${seed}:top`;
        }
        const edgeIds = trackedIds(featureId, edgeSeeds, edgeMap);
        return Result.ok({ shape: result.value.shape, faceIds, edgeIds });
    } finally {
        owned.forEach((x) => x.dispose());
    }
}

registerFeature("extrude", extrudeHandler);
