// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    CurveUtils,
    type FeatureParameter,
    type IEdge,
    type IFace,
    type IShape,
    Line,
    MathUtils,
    Matrix4,
    Result,
    resolveUnitSpec,
    ShapeNode,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { isBodyTimelineNode, isBodyTrackingNode } from "./bodyTracking";
import { trackedBoolean } from "./boolean";
import { matchEdgeIndexes, matchEdgesAnchored } from "./edgeMatcher";
import { captureEdgeRef, type EdgeRef, edgeMidPoint } from "./edgeRef";
import { findSketch } from "./extrude";
import {
    completeTrackedHistory,
    type FeatureContext,
    type FeatureHandler,
    type RevolveFeatureData,
    registerFeature,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { mapToHost, mapToolToHost } from "./hostSpace";
import { applyTrackedOperation } from "./operation";
import { type ResolvedProfile, resolveProfiles } from "./profileBuilder";
import { captureProfileRef } from "./profileRef";
import { attributeSweepEdges, profileEdgeSeeds } from "./profileSeeds";
import { MATCH_TOLERANCE } from "./refGeometry";
import { combineShapes, fuseProfiles } from "./sweepGeometry";
import { fuseOrCombinePieces } from "./sweepTracked";
import { combineIds, derivedId } from "./trackedId";

const revolveHandler: FeatureHandler<RevolveFeatureData> = {
    display: "command.feature.revolve",
    icon: "icon-revolve",
    reselectable: true,

    nodeIds: (feature) =>
        feature.axisSource === undefined || feature.axisSource.nodeId === feature.sketchId
            ? [feature.sketchId]
            : [feature.sketchId, feature.axisSource.nodeId],

    // The axis source stays out of the row: it is a host body the tree already
    // shows, and the revolve's own door is the section sketch.
    references: (feature) => [{ key: "sketchId", display: "body.sketch", nodeId: feature.sketchId }],

    parameters: (feature) => {
        const params: FeatureParameter[] = [
            { key: "angle", display: "common.angle", value: feature.angle, unit: ANGLE_UNITS },
        ];
        if (feature.symmetric !== true) {
            params.push({
                key: "angle2",
                display: "feature.revolve.angle2",
                value: feature.angle2 ?? 0,
                unit: ANGLE_UNITS,
            });
        }
        params.push({
            key: "symmetric",
            display: "option.command.symmetric",
            value: feature.symmetric ?? false,
        });
        return params;
    },

    setParameter: (feature, key, value) => {
        const checked = value === true || value === "true";
        // A symmetric revolve has no second side — drop the stale angle2 instead of
        // tripping the "cannot be both" guard on the next rebuild.
        if (key === "symmetric" && checked) {
            const { angle2: _, ...rest } = feature;
            return { ...rest, symmetric: true };
        }
        return key === "symmetric" ? { ...feature, symmetric: checked } : { ...feature, [key]: value };
    },

    applyResolvedRefs: (feature, { resolvedProfiles, resolvedEdges }) => {
        let next = feature;
        if (resolvedProfiles !== undefined) next = { ...next, profiles: resolvedProfiles };
        const axis = resolvedEdges?.[0];
        if (axis !== undefined && next.axisSource !== undefined) {
            next = { ...next, axisSource: { ...next.axisSource, edge: axis } };
        }
        return next;
    },

    evaluate(feature, context): Result<IShape> {
        const resolved = resolveRevolve(feature, context);
        if (!resolved.isOk) return Result.err(resolved.error);

        const tracked = evaluateOperationTracked(feature, context, resolved.value);
        if (tracked !== undefined) return tracked;

        const built = buildRevolved(resolved.value, context);
        if (!built.isOk) return Result.err(built.error);
        return combineWithInput(built, feature, context);
    },
};

/** One sweep direction of a revolve: the axis as swept and the (positive) angle around it. */
interface RevolveSide {
    readonly axis: Line;
    readonly angle: number;
}

/** A revolve's inputs resolved against the document, plus the axis's re-anchored ref. */
interface ResolvedRevolve {
    readonly sketch: SketchNode;
    /**
     * One entry for a single-sided revolve, two for `symmetric`/`angle2` — the backward half
     * sweeps the FLIPPED axis by a positive angle (a negative-angle revolve is not a kernel
     * case the rest of the pipeline guards, and the flip says the same geometry positively).
     */
    readonly sides: readonly RevolveSide[];
    readonly profiles: ResolvedProfile[];
}

/** The revolved geometry and the ids its kernel history named, in findSubShapes order. */
interface RevolveTool {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * Resolves everything the revolve reads — the sketch, the resolved angle, the live axis
 * and the profiles — and hands the body the refs re-anchored this run (see
 * `ShapeTracking.resolvedProfiles`/`resolvedEdges`).
 */
function resolveRevolve(feature: RevolveFeatureData, context: FeatureContext): Result<ResolvedRevolve> {
    const sketch = findSketch(context.document, feature.sketchId);
    if (sketch === undefined) return Result.err("Sketch not found");

    const angle = resolveUnitSpec(feature.angle, context.scope, ANGLE_UNITS);
    if (!angle.isOk) return Result.err(angle.error);
    const angle2 =
        feature.angle2 === undefined
            ? undefined
            : resolveUnitSpec(feature.angle2, context.scope, ANGLE_UNITS);
    if (angle2 !== undefined && !angle2.isOk) return Result.err(angle2.error);
    if (feature.symmetric === true && angle2 !== undefined) {
        return Result.err("Revolve cannot be both symmetric and have a second angle");
    }
    if (angle2 !== undefined && angle2.value <= 0) return Result.err("Revolve angle2 must be positive");
    const { axis, anchor } = resolveAxis(feature, context);
    const resolved = resolveProfiles(sketch, feature.profiles);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { profiles, missing, refIndexes } = resolved.value;
    const tracking = context.tracking;
    if (tracking !== undefined) {
        // Re-anchored refs for the body's write-back (see ShapeTracking).
        if (anchor !== undefined) tracking.resolvedEdges = [anchor];
        if (feature.profiles !== undefined && feature.profiles.length > 0) {
            // Positional, so a pick that is gone keeps its stored ref (see the extrude path).
            const anchors = [...feature.profiles];
            for (const [k, profile] of profiles.entries()) {
                anchors[refIndexes[k]] = captureProfileRef(profile.face);
            }
            tracking.resolvedProfiles = anchors;
            if (missing.length > 0) tracking.unresolved = { key: "profiles", refIndexes: missing };
        }
    }
    return Result.ok({
        sketch,
        sides: revolveSides(axis, angle.value, feature.symmetric === true, angle2?.value),
        profiles,
    });
}

/** The directions the profiles sweep: forward first, the flipped-axis backward half second. */
function revolveSides(
    axis: Line,
    angle: number,
    symmetric: boolean,
    angle2: number | undefined,
): RevolveSide[] {
    const flip = () => new Line({ point: axis.point, direction: axis.direction.multiply(-1) });
    if (angle2 !== undefined)
        return [
            { axis, angle },
            { axis: flip(), angle: angle2 },
        ];
    if (symmetric)
        return [
            { axis, angle: angle / 2 },
            { axis: flip(), angle: angle / 2 },
        ];
    return [{ axis, angle }];
}

/**
 * Join/cut/intersect on the tracked path: the revolved solid combines with the chain
 * input through the tracked boolean, so the body's own sub-shape ids survive past this
 * feature (the extrude/sweep contract, see `applyTrackedOperation`). Returns undefined
 * when no operation was asked for, or when a tracking capability is missing — the
 * caller then falls back to the plain path.
 */
function evaluateOperationTracked(
    feature: RevolveFeatureData,
    context: FeatureContext,
    resolved: ResolvedRevolve,
): Result<IShape> | undefined {
    if (feature.operation === undefined) return undefined;
    const tracking = context.tracking;
    const tracked = trackedBoolean(feature.operation);
    if (tracking === undefined || tracked === undefined || shapeFactory.revolveTracked === undefined) {
        return undefined;
    }
    const input = context.input;
    if (input === undefined) {
        return Result.err("Revolve join/cut/intersect requires a preceding feature");
    }
    const tool = revolveTool(resolved);
    if (!tool.isOk) return Result.err(tool.error);
    const owned: IShape[] = [];
    try {
        // The revolve is built in world coordinates (sketch profiles, world axis); the
        // boolean runs in the host's space.
        return applyTrackedOperation(input, tracking, tracked, mapToolToHost(tool.value, context, owned));
    } finally {
        // The revolved solid is an intermediate input — the kernel reads it eagerly.
        owned.forEach((x) => x.dispose());
        tool.value.shape.dispose();
    }
}

/** Combines the freshly revolved solid with the chain input, when an operation was asked for. */
function combineWithInput(
    built: Result<IShape>,
    feature: RevolveFeatureData,
    context: FeatureContext,
): Result<IShape> {
    if (!built.isOk || feature.operation === undefined) return built;
    if (context.input === undefined) {
        built.value.dispose();
        return Result.err("Revolve join/cut/intersect requires a preceding feature");
    }
    const owned: IShape[] = [];
    try {
        // The revolved solid is built in world coordinates; the chain input is the host's
        // own shape — the boolean runs in the host's space (see `mapToHost`).
        const tool = mapToHost(built.value, undefined, context, owned);
        switch (feature.operation) {
            case "cut":
                return shapeFactory.booleanCut([context.input], [tool]);
            case "common":
                return shapeFactory.booleanCommon([context.input], [tool]);
            default:
                return shapeFactory.booleanFuse([context.input], [tool], true);
        }
    } finally {
        // The revolved solid is an intermediate input — the kernel reads it eagerly.
        owned.forEach((x) => x.dispose());
        built.value.dispose();
    }
}

/**
 * Revolves every profile. The tracked path names the sub-shapes from the kernel history;
 * without that capability — or with an operation whose tracked path already declined — the
 * solids are combined without ids (downstream refs then re-match geometrically).
 */
function buildRevolved(resolved: ResolvedRevolve, context: FeatureContext): Result<IShape> {
    const tracking = context.tracking;
    if (tracking === undefined || shapeFactory.revolveTracked === undefined) {
        return revolvePlain(resolved);
    }
    const tool = revolveTool(resolved);
    if (!tool.isOk) return Result.err(tool.error);
    tracking.outputFaceIds = tool.value.faceIds;
    tracking.outputEdgeIds = tool.value.edgeIds;
    return Result.ok(tool.value.shape);
}

/**
 * The axis as a live reference: the fingerprinted edge is re-matched against the source node's
 * current shape, so editing the picked axis line moves the revolve.
 *
 * - **Fallback.** The world-space snapshot, when the source is gone, shows a session-rollback
 *   preview, or no longer matches a single line edge.
 * - **Write-back.** A live match also returns the refreshed ref anchor (see
 *   `ShapeTracking.resolvedEdges`).
 * - **Self-source.** When the axis edge lives on an earlier feature of the host body, it
 *   resolves against the feature's INPUT — the shape entering this feature in the current run
 *   (same contract as `resolveSourceFaces` in sourceFaceMatcher.ts). The committed shape is the pre-run
 *   result mid-rebuild, so resolving there would sweep around the stale axis, and a downstream
 *   feature failing on that geometry would wedge the chain with no catch-up pass ever running.
 *   The input's own tracked ids drive the id channel; the node's describe its final shape only.
 *   No rollback guard on this path: during a session preview the input IS the timeline-correct
 *   shape.
 */
function resolveAxis(feature: RevolveFeatureData, context: FeatureContext): { axis: Line; anchor?: EdgeRef } {
    const fallback = snapshotAxis(feature);
    const source = feature.axisSource;
    if (source === undefined) return fallback;

    return source.nodeId === context.host.id
        ? axisFromInput(context, source.edge, fallback)
        : axisFromSourceNode(source.nodeId, source.edge, context, fallback);
}

/** The world-space axis captured at pick time, used whenever the live ref cannot resolve. */
function snapshotAxis(feature: RevolveFeatureData): { axis: Line } {
    return {
        axis: new Line({
            point: new XYZ(feature.axis.point),
            direction: new XYZ(feature.axis.direction),
        }),
    };
}

/** Self-source: the axis edge belongs to an earlier feature, so match it on this feature's input. */
function axisFromInput(
    context: FeatureContext,
    ref: EdgeRef,
    fallback: { axis: Line },
): { axis: Line; anchor?: EdgeRef } {
    if (context.input === undefined) return fallback;
    const edges = context.input.findSubShapes(ShapeTypes.edge) as IEdge[];
    const tracked = context.tracking?.inputEdgeIds;
    const ids = tracked !== undefined && tracked.length === edges.length ? tracked : undefined;
    return matchAxis(context.input, edges, ids, ref, context.host.worldTransform(), fallback);
}

/** Axis on another node: matched on that node's current shape. */
function axisFromSourceNode(
    nodeId: string,
    ref: EdgeRef,
    context: FeatureContext,
    fallback: { axis: Line },
): { axis: Line; anchor?: EdgeRef } {
    const node = context.document.modelManager.findNode((n) => n.id === nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return fallback;
    // A rolled-back source shows a transient session-preview shape lacking every
    // edge born from a hidden feature: the axis must not follow (nor re-anchor
    // onto) geometry the session is about to discard. resolveAxis degrades to the
    // snapshot rather than failing the feature, so the fallback carries no
    // anchor — the live match resumes on the rebuild after the source restores.
    if (isBodyTimelineNode(node) && node.rollbackIndex !== undefined) return fallback;

    const edges = node.shape.value.findSubShapes(ShapeTypes.edge) as IEdge[];
    // A tracked source resolves the axis edge through its stable id first (same
    // contract as every other tracked reference); anything else matches the
    // fingerprint geometrically. A hole in the id array is normal — tracking lapses
    // per sub-shape — and costs nothing here: an edge with no id simply never
    // resolves in the id channel, so a reference to it takes the fingerprint
    // fallback inside `matchEdgesAnchored`.
    const ids = isBodyTrackingNode(node) ? edges.map((_, index) => node.edgeIdAt(index)) : undefined;
    return matchAxis(node.shape.value, edges, ids, ref, node.worldTransform(), fallback);
}

/** Re-matches the axis edge on `shape` (id channel first, geometric fallback) and builds the world-space axis line. */
function matchAxis(
    shape: IShape,
    edges: IEdge[],
    ids: readonly (string | undefined)[] | undefined,
    ref: EdgeRef,
    world: Matrix4,
    fallback: { axis: Line },
): { axis: Line; anchor?: EdgeRef } {
    let index: number;
    let anchor: EdgeRef;
    if (ids !== undefined) {
        const anchored = matchEdgesAnchored(shape, [ref], ids);
        if (!anchored.isOk) return fallback;
        // One ref in, one slot out: a hole in `anchors` means the ref did not match at all.
        const matchedAnchor = anchored.value.anchors[0];
        if (matchedAnchor === undefined) return fallback;
        index = anchored.value.indexes[0];
        anchor = matchedAnchor;
    } else {
        const matched = matchEdgeIndexes(shape, [ref]);
        if (!matched.isOk) return fallback;
        index = matched.value[0];
        // The geometric path reports no anchors — re-capture from the matched edge
        // (an untracked source has no id to carry), the same re-anchoring contract.
        anchor = captureEdgeRef(edges[index]);
    }

    const edge = edges[index];
    const basis = edge.curve.basisCurve;
    if (!CurveUtils.isLine(basis)) return fallback;

    return {
        axis: new Line({
            point: world.ofPoint(edge.startPoint()),
            direction: world.ofVector(basis.direction),
        }),
        anchor,
    };
}

function revolveTool(resolved: ResolvedRevolve): Result<RevolveTool> {
    if (shapeFactory.revolveTracked === undefined) return Result.err("Revolve tracking is unavailable");
    const shapes: IShape[] = [];
    const faceIds: (string | undefined)[] = [];
    const edgeIds: (string | undefined)[] = [];
    for (const profile of resolved.profiles) {
        const halves: { shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] }[] =
            [];
        for (const [index, side] of resolved.sides.entries()) {
            const revolved = revolveProfileTracked(resolved.sketch, side, profile, index === 0 ? "" : ":neg");
            if (!revolved.isOk) return Result.err(revolved.error);
            halves.push(revolved.value);
        }
        // The two halves of one profile share the cap on the profile plane: they fuse, so a
        // downstream reference names ONE face there, not two coincident ones (the extrude's
        // symmetric-sweep convention, through the same `fuseOrCombinePieces`).
        const piece = fuseOrCombinePieces(halves);
        if (!piece.isOk) return Result.err(piece.error);
        shapes.push(piece.value.shape);
        faceIds.push(...piece.value.faceIds);
        edgeIds.push(...piece.value.edgeIds);
    }
    const combined = combineShapes(shapes);
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({ shape: combined.value, faceIds, edgeIds });
}

/** Revolves every profile without kernel history — the fallback when tracking is unavailable. */
function revolvePlain(resolved: ResolvedRevolve): Result<IShape> {
    const shapes: IShape[] = [];
    for (const { face } of resolved.profiles) {
        const halves: IShape[] = [];
        for (const side of resolved.sides) {
            const shape = shapeFactory.revolve(face, side.axis, side.angle);
            if (!shape.isOk) return Result.err(shape.error);
            halves.push(shape.value);
        }
        // One profile's two halves share the cap on the profile plane — fuse them into one
        // solid (fuseProfiles falls back to a compound when the fuse does not apply).
        const fused = halves.length === 1 ? Result.ok(halves[0]) : fuseProfiles(halves);
        if (!fused.isOk) return Result.err(fused.error);
        shapes.push(fused.value);
    }
    // One profile revolves to itself; several combine into one compound. A combined shape's ids
    // stay the profiles' concatenation — the same approximation `sweepProfiles` makes for the
    // extrude tool (the compound's own sub-shape order is not the concatenation order for every
    // kernel build).
    return combineShapes(shapes);
}

/**
 * Revolves one profile with kernel history and maps the tracked ids into
 * findSubShapes order (the rotation counterpart of `sweepFaceTracked`, the sweep
 * extrude and press-pull share).
 *
 * The faces and the edges the swept profile reproduces take the kernel's history; the two
 * families the revolve CREATES — the arc each profile corner sweeps and the end-cap edge each
 * profile edge sweeps — have no history to take, and are named from the rotation itself
 * (`attributeSweepEdges`, the same call extrude makes with its translation).
 */
function revolveProfileTracked(
    sketch: SketchNode,
    side: RevolveSide,
    profile: ResolvedProfile,
    seedSuffix: string,
): Result<{ shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] }> {
    // Guaranteed by the caller's guard — the type just cannot see it.
    if (shapeFactory.revolveTracked === undefined) return Result.err("Revolve tracking is unavailable");
    const result = shapeFactory.revolveTracked(profile.face, side.axis, side.angle);
    if (!result.isOk) return Result.err(result.error);
    // The backward half of a two-sided revolve derives its seed (`:neg`) so its names cannot
    // duplicate the forward half's (the symmetric-extrude convention, see sweepFaceTracked).
    const seed = derivedId(`sketch:${sketch.id}:${profile.seed}`, seedSuffix);
    const faceEdges = profile.face.findSubShapes(ShapeTypes.edge) as IEdge[];
    // Entity-derived edge seeds survive wire re-enumeration (see profileEdgeSeeds).
    const edgeSeeds = profileEdgeSeeds(profile.face, seed, faceEdges);
    // Revolve edge history is sparse; the completed face map feeds both
    // trackedFaceIds and the history-less seeding below.
    const { edgeMap, faceMap, outputEdges, outputFaces } = completeTrackedHistory(
        [profile.face],
        result.value,
        {
            inputEdges: faceEdges,
            inputFaces: [profile.face],
        },
    );
    // Side faces generated from profile edges take the edge's seed (see extrude).
    const faceIds = trackedFaceIds([seed], edgeSeeds, faceMap, result.value.faceEdgeMap);
    seedHistoryLessFaces(
        outputFaces,
        faceIds,
        faceMap,
        result.value.faceEdgeMap,
        faceEdges,
        edgeSeeds,
        seed,
        result.value.capFaces,
    );
    const edgeIds = trackedIds(edgeSeeds, edgeMap);
    // The revolve carries every profile point by a rotation about the axis, so the swept image
    // of a profile edge is its end-cap edge and the swept image of a corner is its arc.
    attributeSweepEdges(
        edgeIds,
        outputEdges,
        edgeMap,
        profile.face,
        seed,
        edgeSeeds,
        Matrix4.fromAxisRad(side.axis.point, side.axis.direction, MathUtils.degToRad(side.angle)),
        ":cap",
    );
    return Result.ok({ shape: result.value.shape, faceIds, edgeIds });
}

/**
 * Seeds the faces the kernel's revolve history does not report. Two are missing by construction:
 * a partial revolve's end cap, and a full turn's end rings (the flange faces an
 * axis-perpendicular profile edge sweeps at 360°). Left alone they would have no id, so a
 * downstream reference to one would have to be re-found geometrically.
 *
 * - **Authoritative first.** The kernel reports a partial revolve's end cap directly through
 *   `capFaces` (the sweep's LastShape), so nothing else runs when it is present.
 * - **Otherwise seed from the profile geometry.** A full turn reports nothing (first and last
 *   shapes coincide), and a kernel predating the channel reports nothing either. Then: the
 *   single history-less face of a partial revolve is the end cap; otherwise each face takes the
 *   seeds of the profile edges lying on its surface (a full-turn ring contains the input edge
 *   that swept it), compounding when a merged ring carries several. Only the edge midpoint is
 *   probed — the endpoints are shared with the neighboring edge's surface.
 * - **Faces no edge claims** stay unnamed.
 */
function seedHistoryLessFaces(
    faces: IFace[],
    faceIds: (string | undefined)[],
    faceMap: number[],
    faceEdgeMap: number[] | undefined,
    faceEdges: IEdge[],
    edgeSeeds: readonly (string | undefined)[],
    seed: string,
    capFaces?: number[],
): void {
    if (capFaces !== undefined && capFaces.length > 0) {
        for (const index of capFaces) {
            if (index >= 0 && index < faceIds.length) faceIds[index] = `${seed}:cap`;
        }
        return;
    }
    const candidates = faceIds.flatMap((_, index) =>
        faceMap[index] < 0 && (faceEdgeMap?.[index] ?? -1) < 0 ? [index] : [],
    );
    if (candidates.length === 0) return;
    if (candidates.length === 1) {
        faceIds[candidates[0]] = `${seed}:cap`;
        return;
    }
    for (const index of candidates) {
        const surface = faces[index].surface();
        const claims = faceEdges.flatMap((edge, edgeIndex) => {
            const seed = edgeSeeds[edgeIndex];
            if (seed === undefined) return [];
            const mid = edgeMidPoint(edge);
            return surface.parameter(mid, MATCH_TOLERANCE) !== undefined ? [seed] : [];
        });
        if (claims.length > 0) faceIds[index] = combineIds(claims);
    }
}

registerFeature("revolve", revolveHandler);
