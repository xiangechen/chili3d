// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type IDocument,
    type IFace,
    type IShape,
    Matrix4,
    Result,
    ShapeNode,
    ShapeTypes,
    type TrackedShape,
    type XYZ,
} from "@chili3d/core";
import { SketchNode } from "../sketch/sketchNode";
import { trackedBoolean } from "./boolean";
import { resolveNumber } from "./expression";
import {
    type ExtrudeFeatureData,
    type FeatureContext,
    type FeatureHandler,
    registerFeature,
    type ShapeTracking,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { type ResolvedProfile, resolveProfiles } from "./profileBuilder";
import { captureProfileRef, matchProfileIndexes } from "./profileRef";

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

    parameters: (feature) => [
        { key: "length", display: "common.length", value: feature.length },
        { key: "symmetric", display: "option.command.symmetric", value: feature.symmetric ?? false },
    ],

    setParameter: (feature, key, value) =>
        key === "symmetric"
            ? { ...feature, symmetric: value === true || value === "true" }
            : { ...feature, [key]: value },

    evaluate(feature, context): Result<IShape> {
        const length = resolveNumber(feature.length, context.scope);
        if (!length.isOk) return Result.err(length.error);

        // Join/cut/intersect from sketch profiles prefers the tracked path, so
        // downstream edge refs keep stable ids through the boolean.
        if (feature.operation !== undefined && feature.source === undefined) {
            const tracked = extrudeOperationTracked(feature, context, length.value);
            if (tracked !== undefined) return tracked;
        }

        const source = feature.source;
        const built =
            source === undefined
                ? extrudeFromSketch(feature, context, length.value)
                : extrudeFromSourceFaces({ ...feature, source }, context, length.value);
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
    },
};

/** Extrudes the referenced sketch profiles (the classic path). */
function extrudeFromSketch(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    length: number,
): Result<IShape> {
    const resolved = resolveSketchProfiles(feature, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { sketch, profiles } = resolved.value;
    const vec = sketch.plane.normal.multiply(length);
    const vecs = feature.symmetric === true ? [vec, vec.multiply(-1)] : [vec];

    // An operation with unavailable tracking falls back to the plain path — downstream
    // edge fingerprints then re-match geometrically after a rebuild.
    const plain =
        feature.operation !== undefined ||
        context.tracking === undefined ||
        shapeFactory.prismTracked === undefined;
    return plain
        ? extrudePlain(profiles, vecs)
        : extrudeTracked(feature, sketch, vecs, profiles, context.tracking!);
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

/**
 * Press-pull from planar faces of an existing body: the stored fingerprints (captured
 * in world coordinates) re-match on the source node's current shape — or on the
 * feature's input when the source is the host body itself, whose full shape already
 * contains this feature's output. Each face sweeps along its own live outward normal.
 * Always plain (untracked): the fingerprints are the identity, like the boolean path.
 */
function extrudeFromSourceFaces(
    feature: ExtrudeFeatureData & { source: NonNullable<ExtrudeFeatureData["source"]> },
    context: FeatureContext,
    length: number,
): Result<IShape> {
    const resolved = resolveSourceFaces(feature.source, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { worldFaces, owned } = resolved.value;
    try {
        const indexes = matchProfileIndexes(worldFaces, feature.source.profiles);
        if (!indexes.isOk) return Result.err(indexes.error);
        // Re-anchor the stored fingerprints on the faces matched this run, same as
        // the sketch path — must happen before the finally disposes worldFaces.
        if (context.tracking !== undefined) {
            context.tracking.resolvedProfiles = indexes.value.map((index) =>
                captureProfileRef(worldFaces[index]),
            );
        }
        return sweepFaces(
            indexes.value.map((index) => worldFaces[index]),
            (face) => {
                const vec = face.normal(0, 0)[1].multiply(length);
                return feature.symmetric === true ? [vec, vec.multiply(-1)] : [vec];
            },
        );
    } finally {
        owned.forEach((x) => x.dispose());
    }
}

/**
 * The current faces of the source node in world coordinates — or of the feature's
 * input when the source is the host body itself, whose full shape already contains
 * this feature's output. `owned` holds the transformed copies for the caller to
 * dispose (empty when the source sits at the identity transform).
 */
function resolveSourceFaces(
    source: NonNullable<ExtrudeFeatureData["source"]>,
    context: FeatureContext,
): Result<{ worldFaces: IFace[]; owned: IFace[] }> {
    let faces: IFace[];
    let transform: Matrix4;
    if (source.nodeId === context.host.id) {
        if (context.input === undefined) {
            return Result.err("Extrude source face requires a preceding feature");
        }
        faces = context.input.findSubShapes(ShapeTypes.face) as IFace[];
        transform = context.host.worldTransform();
    } else {
        const node = context.document.modelManager.findNode((n) => n.id === source.nodeId);
        if (!(node instanceof ShapeNode) || !node.shape.isOk) {
            return Result.err("Extrude source body not found");
        }
        faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
        transform = node.worldTransform();
    }

    const identity = transform.equals(Matrix4.identity());
    const worldFaces = identity ? faces : faces.map((x) => x.transformedMul(transform) as IFace);
    return Result.ok({ worldFaces, owned: identity ? [] : worldFaces });
}

/** Sweeps every profile along each direction and merges touching prisms (see `fuseProfiles`). */
function extrudePlain(profiles: ResolvedProfile[], vecs: XYZ[]): Result<IShape> {
    return sweepFaces(
        profiles.map(({ face }) => face),
        () => vecs,
    );
}

/** Sweeps each face along its own vectors (`vecsOf`) and merges touching prisms. */
function sweepFaces(faces: IFace[], vecsOf: (face: IFace) => XYZ[]): Result<IShape> {
    const shapes: IShape[] = [];
    for (const face of faces) {
        for (const vec of vecsOf(face)) {
            const shape = shapeFactory.prism(face, vec);
            if (!shape.isOk) {
                shapes.forEach((x) => x.dispose());
                return Result.err(shape.error);
            }
            shapes.push(shape.value);
        }
    }
    return fuseProfiles(shapes);
}

/**
 * Merges per-profile prisms into a single solid when they touch — `booleanFuse`
 * keeps disjoint solids separate, so disjoint profiles degrade to a compound. The
 * bounding-box precheck skips the boolean (the most expensive step of a rebuild)
 * when no pair can possibly touch; a failed fuse falls back to the plain compound.
 */
export function fuseProfiles(shapes: IShape[]): Result<IShape> {
    if (shapes.length > 1 && anyPairTouches(shapes)) {
        const fused = shapeFactory.booleanFuse([shapes[0]], shapes.slice(1), true);
        if (fused.isOk) {
            shapes.forEach((x) => x.dispose());
            return Result.ok(fused.value);
        }
    }
    return combineShapes(shapes);
}

function combineShapes(shapes: IShape[]): Result<IShape> {
    return shapes.length === 1 ? Result.ok(shapes[0]) : shapeFactory.combine(shapes);
}

function anyPairTouches(shapes: IShape[]): boolean {
    const boxes = shapes.map((x) => x.boundingBox());
    return boxes.some((box, i) => boxes.slice(i + 1).some((other) => BoundingBox.isIntersect(box, other)));
}

function extrudeTracked(
    feature: ExtrudeFeatureData,
    sketch: SketchNode,
    vecs: XYZ[],
    profiles: ResolvedProfile[],
    tracking: ShapeTracking,
): Result<IShape> {
    const swept = sweepProfiles(feature, sketch, vecs, profiles);
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
): Result<{ shape: IShape; faceIds: string[]; edgeIds: string[] }> {
    const shapes: IShape[] = [];
    const faceIds: string[][] = [];
    const edgeIds: string[][] = [];
    for (const profile of profiles) {
        for (const [direction, vec] of vecs.entries()) {
            const swept = sweepProfileTracked(feature, sketch, vec, profile, direction === 0 ? "" : ":neg");
            if (!swept.isOk) return Result.err(swept.error);
            shapes.push(swept.value.shape);
            faceIds.push(swept.value.faceIds);
            edgeIds.push(swept.value.edgeIds);
        }
    }
    if (shapes.length > 1 && anyPairTouches(shapes) && shapeFactory.booleanFuseTracked !== undefined) {
        const fused = shapeFactory.booleanFuseTracked([shapes[0]], shapes.slice(1));
        if (fused.isOk) {
            const merged = {
                shape: fused.value.shape,
                faceIds: mapFusedIds(feature.id, faceIds, fused.value.faceMap),
                edgeIds: mapFusedIds(feature.id, edgeIds, fused.value.edgeMap),
            };
            shapes.forEach((x) => x.dispose());
            return Result.ok(merged);
        }
    }
    const combined = combineShapes(shapes);
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({ shape: combined.value, faceIds: faceIds.flat(), edgeIds: edgeIds.flat() });
}

/**
 * Join/cut/intersect on the tracked path: profiles are swept with kernel history
 * (sketch-scoped ids), then combined with the chain input via the tracked boolean —
 * downstream edge refs (fillet/chamfer) keep their stable ids across rebuilds instead
 * of re-matching geometrically, where a large sketch edit strands them between
 * look-alike candidates. Returns undefined when a tracking capability is missing
 * (the caller falls back to the plain path); press-pull extrudes stay plain.
 */
function extrudeOperationTracked(
    feature: ExtrudeFeatureData,
    context: FeatureContext,
    length: number,
): Result<IShape> | undefined {
    const tracking = context.tracking;
    const tracked = trackedBoolean(feature.operation!);
    if (tracking === undefined || tracked === undefined || shapeFactory.prismTracked === undefined) {
        return undefined;
    }
    if (context.input === undefined) {
        return Result.err("Extrude join/cut/intersect requires a preceding feature");
    }
    const resolved = resolveSketchProfiles(feature, context);
    if (!resolved.isOk) return Result.err(resolved.error);

    const vec = resolved.value.sketch.plane.normal.multiply(length);
    const vecs = feature.symmetric === true ? [vec, vec.multiply(-1)] : [vec];
    const tool = sweepProfiles(feature, resolved.value.sketch, vecs, resolved.value.profiles);
    if (!tool.isOk) return Result.err(tool.error);
    try {
        const result = tracked([context.input], [tool.value.shape]);
        if (!result.isOk) return Result.err(result.error);
        trackOperation(feature.id, context.input, tracking, tool.value, result.value);
        return Result.ok(result.value.shape);
    } finally {
        // The prism is an intermediate input — the kernel reads it eagerly.
        tool.value.shape.dispose();
    }
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
    );
    tracking.outputEdgeIds = mapOperationIds(
        featureId,
        input,
        tracking.inputEdgeIds,
        tool.edgeIds,
        result.edgeMap,
        ShapeTypes.edge,
    );
}

/**
 * Maps the boolean history of a join/cut/intersect extrude to stable ids. The kernel
 * enumerates the main body's sub-shapes first, then the tool's: main-body hits keep
 * the input's id, tool hits take the sweep's sketch-scoped id, and boolean-born
 * sub-shapes (e.g. intersection edges) get feature-scoped ids. The main/tool boundary
 * is the tracked-id count when available, else the input's own sub-shape count (same
 * untracked-upstream guard as `mapBooleanIds` in boolean.ts).
 */
function mapOperationIds(
    featureId: string,
    input: IShape,
    inputIds: readonly string[],
    toolIds: readonly string[],
    map: number[],
    type: (typeof ShapeTypes)["face" | "edge"],
): string[] {
    const mainCount = Math.max(inputIds.length, input.findSubShapes(type).length);
    return map.map((inputIndex, outputIndex) => {
        if (inputIndex >= 0 && inputIndex < inputIds.length) return inputIds[inputIndex];
        const toolIndex = inputIndex - mainCount;
        if (inputIndex < mainCount || toolIndex >= toolIds.length) return `${featureId}:${outputIndex}`;
        return toolIds[toolIndex];
    });
}

/**
 * Sweeps one profile with kernel history and maps the history to stable ids: profile
 * edges seed sketch-scoped ids (the prism's bottom edges are identical to them); edges
 * the sweep history does not cover get feature-scoped ids. Each profile face seeds one
 * id, which prism history propagates to the bottom/top faces; side faces are generated
 * from profile edges and take that edge's seed, so a rebuild that re-enumerates faces
 * (e.g. a mirrored profile) cannot realign them. `seedSuffix` keeps the mirrored half
 * of a symmetric sweep from duplicating the first half's ids.
 */
function sweepProfileTracked(
    feature: ExtrudeFeatureData,
    sketch: SketchNode,
    vec: XYZ,
    profile: ResolvedProfile,
    seedSuffix = "",
): Result<{ shape: IShape; faceIds: string[]; edgeIds: string[] }> {
    const result = shapeFactory.prismTracked!(profile.face, vec);
    if (!result.isOk) return Result.err(result.error);
    const seed = `sketch:${sketch.id}:${profile.index}${seedSuffix}`;
    const edgeSeeds = profile.face
        .findSubShapes(ShapeTypes.edge)
        .map((_, edgeIndex) => `${seed}:e${edgeIndex}`);
    const featureId = `${feature.id}${seedSuffix}`;
    const faceIds = trackedFaceIds(
        featureId,
        [seed],
        edgeSeeds,
        result.value.faceMap,
        result.value.faceEdgeMap,
    );
    const edgeIds = trackedIds(featureId, edgeSeeds, result.value.edgeMap);
    return Result.ok({ shape: result.value.shape, faceIds, edgeIds });
}

/**
 * Maps fuse history to the per-profile tracked ids: the input enumerates the args
 * sub-shapes (profile 0) first, then each tool profile in order. Fuse-born
 * sub-shapes (e.g. merged seam faces) get feature-scoped ids.
 */
function mapFusedIds(featureId: string, idsPerProfile: string[][], map: number[]): string[] {
    const argsIds = idsPerProfile[0];
    let start = argsIds.length;
    const toolRanges = idsPerProfile.slice(1).map((ids) => {
        const range = { ids, start };
        start += ids.length;
        return range;
    });
    return map.map((inputIndex, outputIndex) => {
        if (inputIndex >= 0 && inputIndex < argsIds.length) return argsIds[inputIndex];
        const range = toolRanges.find((x) => inputIndex >= x.start && inputIndex < x.start + x.ids.length);
        return range === undefined ? `${featureId}:${outputIndex}` : range.ids[inputIndex - range.start];
    });
}

registerFeature("extrude", extrudeHandler);
