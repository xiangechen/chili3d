// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    Matrix4,
    Precision,
    Result,
    ShapeNode,
    ShapeTypes,
    type TrackedShape,
    type XYZ,
} from "@chili3d/core";
import { SketchNode } from "../sketch/sketchNode";
import { isBodyTimelineNode, isBodyTrackingNode } from "./bodyTracking";
import { trackedBoolean } from "./boolean";
import { indexesOfOverlappingId, MATCH_TOLERANCE } from "./edgeRef";
import { resolveNumber } from "./expression";
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
import { profileEdgeSeeds, type ResolvedProfile, resolveProfiles } from "./profileBuilder";
import {
    captureProfileRef,
    matchProfileIndexes,
    type ProfileRef,
    profileEdgeEntityIds,
    profileScore,
    registerProfileEdgeEntities,
} from "./profileRef";
import { mapAncestorIds } from "./trackedId";

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
        { key: "depth", display: "option.command.depth", value: feature.depth },
        { key: "startOffset", display: "option.command.startOffset", value: feature.startOffset ?? 0 },
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
        const depth = resolveNumber(feature.depth, context.scope);
        if (!depth.isOk) return Result.err(depth.error);
        const startOffset = resolveNumber(feature.startOffset ?? 0, context.scope);
        if (!startOffset.isOk) return Result.err(startOffset.error);

        // Join/cut/intersect from sketch profiles prefers the tracked path, so
        // downstream edge refs keep stable ids through the boolean.
        if (feature.operation !== undefined && feature.source === undefined) {
            const tracked = extrudeOperationTracked(feature, context, depth.value, startOffset.value);
            if (tracked !== undefined) return tracked;
        }

        // Press-pull with an operation takes the tracked boolean too, so the body's
        // own face ids survive past this feature and later press-pulls still resolve
        // by id (see pressPullOperationTracked).
        if (feature.operation !== undefined && feature.source !== undefined) {
            const tracked = pressPullOperationTracked(
                { ...feature, source: feature.source },
                context,
                depth.value,
                startOffset.value,
            );
            if (tracked !== undefined) return tracked;
        }

        const source = feature.source;
        const built =
            source === undefined
                ? extrudeFromSketch(feature, context, depth.value, startOffset.value)
                : extrudeFromSourceFaces({ ...feature, source }, context, depth.value, startOffset.value);
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

/**
 * Press-pull from planar faces of an existing body: refs carrying a tracked face id
 * claim the faces whose id intersects it (a face split by a later cut shares one id
 * across its pieces; a face MERGED from several faces combines their ids into a
 * compound, so a later re-split's pieces all intersect it — every piece is swept,
 * mirroring `EdgeRef`'s whole-span adoption — unless the ref was captured from ONE
 * piece of an already split face: stamped `splitPiece` at the pick, it never widens,
 * see `narrowToPickedPiece`); refs without an id (legacy documents) or whose id
 * vanished entirely (the face was consumed) re-match by geometric fingerprint among
 * the faces left over — with the outward `normal` of the pick rejecting candidates
 * that face away (a consumed groove ceiling vs its floor and walls). Matching runs
 * on the source node's current shape — or on the feature's input when the source is
 * the host body itself, whose full shape already contains this feature's output.
 * Each face sweeps along its own live outward normal.
 * The sweep itself stays plain (untracked); the operation boolean combining it with
 * the input is tracked when the capability exists (`pressPullOperationTracked`).
 */
function extrudeFromSourceFaces(
    feature: ExtrudeFeatureData & { source: NonNullable<ExtrudeFeatureData["source"]> },
    context: FeatureContext,
    depth: number,
    startOffset: number,
): Result<IShape> {
    const resolved = resolveSourceFaces(feature.source, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { worldFaces, faceIds, owned } = resolved.value;
    try {
        const matched = matchSourceFaceIndexes(worldFaces, faceIds, feature.source.profiles);
        if (!matched.isOk) return Result.err(matched.error);
        // Re-anchor on the faces actually swept — one ref per adopted face, so a face
        // split since the pick becomes one ref per piece — before the finally disposes
        // worldFaces. Each re-anchored ref keeps the `splitPiece` of the ref that
        // adopted it; re-anchoring never stamps the flag on a ref that lacked it.
        // Same drift-from-latest-match contract as the sketch path.
        if (context.tracking !== undefined) {
            context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
                captureProfileRef(
                    worldFaces[faceIndex],
                    faceIds?.[faceIndex],
                    feature.source.profiles[matched.value.refIndexes[k]].splitPiece,
                    true,
                ),
            );
        }
        return sweepFaces(
            matched.value.indexes.map((index) => worldFaces[index]),
            (face) => {
                const vec = face.normal(0, 0)[1].multiply(depth);
                return feature.symmetric === true ? [vec, vec.multiply(-1)] : [vec];
            },
            (face) => face.normal(0, 0)[1].multiply(startOffset),
        );
    } finally {
        owned.forEach((x) => x.dispose());
    }
}

/**
 * The faces a press-pull sweeps, plus the ref that adopted each — `indexes` and
 * `refIndexes` are parallel (a position in the feature's `source.profiles`). The id
 * path's `taken` guard and `matchProfileIndexes`' one-claim-per-ref keep `indexes`
 * duplicate-free, so callers re-anchor exactly one ref per entry.
 */
export interface MatchedSourceFaces {
    readonly indexes: number[];
    readonly refIndexes: number[];
}

/**
 * Face indexes to sweep, one entry per adopted face: refs with a tracked face id claim
 * the faces whose id intersects it (`idsOverlap` — pieces of a cut-split face share
 * the id, and pieces of a re-split MERGE carry its components; hits already claimed by
 * an earlier ref with an overlapping id — produced when a split face was re-anchored
 * per piece — count as satisfied). Several hits narrow by `narrowToPickedPiece`: a ref
 * stamped `splitPiece` at capture never widens to the whole span, an unflagged ref
 * keeps it (the pinned heal case). Refs without a live id re-match geometrically among
 * the unclaimed faces.
 */
export function matchSourceFaceIndexes(
    faces: IFace[],
    faceIds: readonly (string | undefined)[] | undefined,
    refs: ProfileRef[],
): Result<MatchedSourceFaces> {
    const adopted: number[] = [];
    const adoptedBy: number[] = [];
    const taken = new Set<number>();
    const fingerprintRefs: number[] = [];
    for (const [refIndex, ref] of refs.entries()) {
        const refId = ref.id;
        const hits =
            refId === undefined || faceIds === undefined ? [] : indexesOfOverlappingId(faceIds, refId);
        if (hits.length === 0) {
            fingerprintRefs.push(refIndex);
            continue;
        }
        const narrowed = narrowToPickedPiece(faces, ref, hits);
        if (!narrowed.isOk) return Result.err(narrowed.error);
        for (const hit of narrowed.value) {
            if (!taken.has(hit)) {
                taken.add(hit);
                adopted.push(hit);
                adoptedBy.push(refIndex);
            }
        }
    }
    const result: MatchedSourceFaces = { indexes: adopted, refIndexes: adoptedBy };
    if (fingerprintRefs.length === 0) return Result.ok(result);

    const remainingIndexes = faces.map((_, index) => index).filter((index) => !taken.has(index));
    const remainingRefs = fingerprintRefs.map((index) => refs[index]);
    const matched = matchProfileIndexes(
        remainingIndexes.map((index) => faces[index]),
        remainingRefs,
        undefined,
        // A ref whose tracked id died competes only for faces WITHOUT a live id of
        // their own: an id-carrying face already has an identity, and adopting one
        // would silently sweep a stranger (a consumed groove ceiling "moving" onto
        // the box bottom — same normal, same edge count, a finite edge score away).
        // Id-less legacy refs keep the free geometric re-match.
        (refIndex, faceIndex) =>
            remainingRefs[refIndex].id === undefined || faceIds?.[remainingIndexes[faceIndex]] === undefined,
    );
    if (!matched.isOk) return Result.err(SOURCE_FACE_ERRORS[matched.error] ?? matched.error);
    for (const [k, index] of matched.value.entries()) {
        adopted.push(remainingIndexes[index]);
        adoptedBy.push(fingerprintRefs[k]);
    }
    return Result.ok(result);
}

/**
 * Face-worded rewrites of the fingerprint fallback's sketch-flavored messages — a
 * press-pull ref names a solid face, so "Sketch profile …" misleads (the fallback
 * shared with sketch profiles is an implementation detail).
 */
const SOURCE_FACE_ERRORS: Record<string, string> = {
    "Sketch profile match is ambiguous after rebuild": "Face match is ambiguous after rebuild",
    "Sketch profile not found after rebuild": "Face not found after rebuild",
};

/**
 * Several id hits are the pieces of a face split since the pick (or of a re-split
 * merge) — the face counterpart of `singleExactHit` in edgeRef.ts. Exactly one piece
 * still matching the fingerprint within tolerance claims the ref (the pick was that
 * piece). Otherwise an unflagged ref keeps the whole-span adoption: it covered the
 * whole face (captured on a merged face that later re-split, the pinned heal case) or
 * its fingerprint went stale. A ref stamped `splitPiece` never widens: a stale pick
 * adopts the clear nearest piece (the runner-up at least MATCH_TOLERANCE farther, the
 * `completeHistory` margin convention), and a tie or several exact pieces fails
 * "Face match is ambiguous after rebuild" instead of silently sweeping siblings.
 */
function narrowToPickedPiece(faces: IFace[], ref: ProfileRef, hits: number[]): Result<number[]> {
    if (hits.length === 1) return Result.ok(hits);
    const exact = hits.filter(
        (index) => profileScore(faces[index], ref) <= MATCH_TOLERANCE * ref.edges.length,
    );
    if (exact.length === 1) return Result.ok(exact);
    if (ref.splitPiece !== true) return Result.ok(hits);
    if (exact.length > 1) return Result.err("Face match is ambiguous after rebuild");
    const scored = hits
        .map((index) => ({ index, score: profileScore(faces[index], ref) }))
        .sort((a, b) => a.score - b.score);
    const best = scored[0];
    const second = scored[1];
    if (
        best !== undefined &&
        Number.isFinite(best.score) &&
        (second === undefined || second.score - best.score >= MATCH_TOLERANCE)
    ) {
        return Result.ok([best.index]);
    }
    return Result.err("Face match is ambiguous after rebuild");
}

/**
 * The current faces of the source node in world coordinates — or of the feature's
 * input when the source is the host body itself, whose full shape already contains
 * this feature's output. `faceIds` runs parallel to `worldFaces` with the source's
 * tracked face ids when available (undefined entries where tracking lapsed; wholly
 * undefined for non-parametric sources). `owned` holds the transformed copies for
 * the caller to dispose (empty when the source sits at the identity transform). A
 * source showing a session-rollback preview is refused outright: the transient
 * shape lacks later features' faces, and matching would persist anchors onto it.
 */
function resolveSourceFaces(
    source: NonNullable<ExtrudeFeatureData["source"]>,
    context: FeatureContext,
): Result<{ worldFaces: IFace[]; faceIds: readonly (string | undefined)[] | undefined; owned: IFace[] }> {
    let faces: IFace[];
    let faceIds: readonly (string | undefined)[] | undefined;
    let transform: Matrix4;
    if (source.nodeId === context.host.id) {
        if (context.input === undefined) {
            return Result.err("Extrude source face requires a preceding feature");
        }
        faces = context.input.findSubShapes(ShapeTypes.face) as IFace[];
        const tracked = context.tracking?.inputFaceIds;
        faceIds = tracked !== undefined && tracked.length === faces.length ? tracked : undefined;
        transform = context.host.worldTransform();
    } else {
        const node = context.document.modelManager.findNode((n) => n.id === source.nodeId);
        if (!(node instanceof ShapeNode) || !node.shape.isOk) {
            return Result.err("Extrude source body not found");
        }
        // A rolled-back source shows a transient session-preview shape lacking every
        // face born from a hidden feature: matching against it would re-anchor (and
        // untransacted persist) the profile refs onto the preview. Fail instead — the
        // feature keeps its old shape and self-heals on the watch-triggered rebuild
        // once the source restores (the sketch-side refs guard the same way, see
        // SketchNode.handlePlaneRefNodeChanged).
        if (isBodyTimelineNode(node) && node.rollbackIndex !== undefined) {
            return Result.err("Extrude source body is rolled back for a sketch session");
        }
        faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
        faceIds = isBodyTrackingNode(node) ? faces.map((_, index) => node.faceIdAt(index)) : undefined;
        transform = node.worldTransform();
    }

    const identity = transform.equals(Matrix4.identity());
    const worldFaces = identity ? faces : faces.map((x) => x.transformedMul(transform) as IFace);
    return Result.ok({ worldFaces, faceIds, owned: identity ? [] : worldFaces });
}

/** Sweeps every profile along each direction and merges touching prisms (see `fuseProfiles`). */
function extrudePlain(profiles: ResolvedProfile[], vecs: XYZ[], offsetVec: XYZ): Result<IShape> {
    return sweepFaces(
        profiles.map(({ face }) => face),
        () => vecs,
        () => offsetVec,
    );
}

/** Sweeps each face along its own vectors (`vecsOf`) and merges touching prisms. */
function sweepFaces(
    faces: IFace[],
    vecsOf: (face: IFace) => XYZ[],
    offsetOf: (face: IFace) => XYZ,
): Result<IShape> {
    const shapes: IShape[] = [];
    const owned: IFace[] = [];
    try {
        for (const face of faces) {
            const sweptFace = translateFace(face, offsetOf(face), owned);
            for (const vec of vecsOf(face)) {
                const shape = shapeFactory.prism(sweptFace, vec);
                if (!shape.isOk) {
                    shapes.forEach((x) => x.dispose());
                    return Result.err(shape.error);
                }
                shapes.push(shape.value);
            }
        }
    } finally {
        owned.forEach((x) => x.dispose());
    }
    return fuseProfiles(shapes);
}

/**
 * Translates `face` along `vec` to apply a start offset; a near-zero offset returns
 * the face unchanged. Translated copies are pushed to `owned` for the caller to
 * dispose after the kernel has read them eagerly.
 */
function translateFace(face: IFace, vec: XYZ, owned: IFace[]): IFace {
    if (vec.length() < Precision.Float) return face;
    const translated = face.transformedMul(Matrix4.fromTranslation(vec.x, vec.y, vec.z)) as IFace;
    owned.push(translated);
    return translated;
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
    if (context.input === undefined) {
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
        const result = tracked([context.input], [tool.value.shape]);
        if (!result.isOk) return Result.err(result.error);
        const { edgeMap, faceMap } = completeTrackedHistory([context.input, tool.value.shape], result.value);
        trackOperation(feature.id, context.input, tracking, tool.value, {
            ...result.value,
            edgeMap,
            faceMap,
        });
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
 * Maps the boolean history of a join/cut/intersect extrude to stable ids. The kernel
 * enumerates the main body's sub-shapes first, then the tool's: main-body hits keep
 * the input's id, tool hits take the sweep's sketch-scoped id, and boolean-born
 * sub-shapes (e.g. intersection edges) get feature-scoped ids. The main/tool boundary
 * is the tracked-id count when available, else the input's own sub-shape count (same
 * untracked-upstream guard as `mapBooleanIds` in boolean.ts). The kernel's full
 * derivation pairs (`ancestors`) extend the single-valued map: a sub-shape MERGED
 * from several inputs combines every ancestor's id into a compound (`combineIds`),
 * so pieces of a later re-split still intersect the stored id.
 */
function mapOperationIds(
    featureId: string,
    input: IShape,
    inputIds: readonly string[],
    toolIds: readonly string[],
    map: number[],
    type: (typeof ShapeTypes)["face" | "edge"],
    ancestors?: number[],
): string[] {
    const mainCount = Math.max(inputIds.length, input.findSubShapes(type).length);
    const idOfInput = (inputIndex: number, outputIndex: number): string => {
        if (inputIndex >= 0 && inputIndex < inputIds.length) return inputIds[inputIndex];
        const toolIndex = inputIndex - mainCount;
        if (inputIndex < mainCount || toolIndex >= toolIds.length) return `${featureId}:${outputIndex}`;
        return toolIds[toolIndex];
    };
    return mapAncestorIds(featureId, map, ancestors, idOfInput);
}

/**
 * Sweeps one profile with kernel history and maps the history to stable ids: profile
 * edges seed sketch-scoped ids (the prism's bottom edges are identical to them); edges
 * the sweep history does not cover get feature-scoped ids. Each profile face seeds one
 * id, which prism history propagates to the bottom face (it is identical to the
 * profile); the TOP face has no sweep history (it is neither the identical bottom nor
 * an edge-generated side) — the kernel reports it directly through `capFaces`
 * (LastShape) and it takes the profile's synthetic `:top` seed, since a positional
 * feature-scoped id would realign onto another face when the sketch's structure
 * changes; a kernel predating that channel falls back to the unique-history-less-face
 * heuristic. Side faces are generated from profile edges and take that edge's seed, so
 * a rebuild that re-enumerates faces (e.g. a mirrored profile) cannot realign them.
 * `seedSuffix` keeps the mirrored half of a symmetric sweep from duplicating the
 * first half's ids.
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
