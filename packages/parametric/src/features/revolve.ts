// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    type IEdge,
    type IFace,
    type IShape,
    Line,
    type Matrix4,
    Result,
    ShapeNode,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { isBodyTimelineNode, isBodyTrackingNode } from "./bodyTracking";
import { matchEdgeIndexes, matchEdgesAnchored } from "./edgeMatcher";
import { captureEdgeRef, type EdgeRef } from "./edgeRef";
import { resolveNumber } from "./expression";
import { findSketch } from "./extrude";
import {
    completeTrackedHistory,
    type FeatureContext,
    type FeatureHandler,
    type RevolveFeatureData,
    registerFeature,
    type ShapeTracking,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { type ResolvedProfile, resolveProfiles } from "./profileBuilder";
import { captureProfileRef } from "./profileRef";
import { profileEdgeSeeds } from "./profileSeeds";
import { MATCH_TOLERANCE } from "./refGeometry";
import { combineIds } from "./trackedId";

const revolveHandler: FeatureHandler<RevolveFeatureData> = {
    display: "command.feature.revolve",
    icon: "icon-revolve",

    nodeIds: (feature) =>
        feature.axisSource === undefined || feature.axisSource.nodeId === feature.sketchId
            ? [feature.sketchId]
            : [feature.sketchId, feature.axisSource.nodeId],

    parameters: (feature) => [{ key: "angle", display: "common.angle", value: feature.angle }],

    setParameter: (feature, key, value) => ({ ...feature, [key]: value }),

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
        const sketch = findSketch(context.document, feature.sketchId);
        if (sketch === undefined) return Result.err("Sketch not found");

        const angle = resolveNumber(feature.angle, context.scope);
        if (!angle.isOk) return Result.err(angle.error);
        const { axis, anchor } = resolveAxis(feature, context);
        const profiles = resolveProfiles(sketch, feature.profiles);
        if (!profiles.isOk) return Result.err(profiles.error);
        const tracking = context.tracking;
        if (tracking !== undefined) {
            // Re-anchored refs for the body's write-back (see ShapeTracking).
            if (anchor !== undefined) tracking.resolvedEdges = [anchor];
            if (feature.profiles !== undefined && feature.profiles.length > 0) {
                tracking.resolvedProfiles = profiles.value.map(({ face }) => captureProfileRef(face));
            }
        }
        if (tracking === undefined || shapeFactory.revolveTracked === undefined) {
            const shapes: IShape[] = [];
            for (const { face } of profiles.value) {
                const shape = shapeFactory.revolve(face, axis, angle.value);
                if (!shape.isOk) return Result.err(shape.error);
                shapes.push(shape.value);
            }
            return shapes.length === 1 ? Result.ok(shapes[0]) : shapeFactory.combine(shapes);
        }
        return revolveTracked(feature, sketch, axis, angle.value, profiles.value, tracking);
    },
};

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
 *   (same contract as `resolveSourceFaces` in pressPull.ts). The committed shape is the pre-run
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
    // fingerprint geometrically. The id channel needs the full id array — a
    // partially tracked source stays on the geometric path.
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
    if (ids !== undefined && ids.every((id) => id !== undefined)) {
        const anchored = matchEdgesAnchored(shape, [ref], ids as string[]);
        if (!anchored.isOk) return fallback;
        index = anchored.value.indexes[0];
        anchor = anchored.value.anchors[0];
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

function revolveTracked(
    feature: RevolveFeatureData,
    sketch: SketchNode,
    axis: Line,
    angle: number,
    profiles: ResolvedProfile[],
    tracking: ShapeTracking,
): Result<IShape> {
    const shapes: IShape[] = [];
    const outputFaceIds: string[] = [];
    const outputEdgeIds: string[] = [];
    for (const profile of profiles) {
        const revolved = revolveProfileTracked(feature, sketch, axis, angle, profile);
        if (!revolved.isOk) return Result.err(revolved.error);
        shapes.push(revolved.value.shape);
        outputFaceIds.push(...revolved.value.faceIds);
        outputEdgeIds.push(...revolved.value.edgeIds);
    }
    tracking.outputFaceIds = outputFaceIds;
    tracking.outputEdgeIds = outputEdgeIds;
    return shapes.length === 1 ? Result.ok(shapes[0]) : shapeFactory.combine(shapes);
}

/**
 * Revolves one profile with kernel history and maps the tracked ids into
 * findSubShapes order (the per-profile half of extrude's sweepProfileTracked).
 */
function revolveProfileTracked(
    feature: RevolveFeatureData,
    sketch: SketchNode,
    axis: Line,
    angle: number,
    profile: ResolvedProfile,
): Result<{ shape: IShape; faceIds: string[]; edgeIds: string[] }> {
    // Guaranteed by the caller's guard — the type just cannot see it.
    if (shapeFactory.revolveTracked === undefined) return Result.err("Revolve tracking is unavailable");
    const result = shapeFactory.revolveTracked(profile.face, axis, angle);
    if (!result.isOk) return Result.err(result.error);
    const seed = `sketch:${sketch.id}:${profile.seed}`;
    const faceEdges = profile.face.findSubShapes(ShapeTypes.edge) as IEdge[];
    // Entity-derived edge seeds survive wire re-enumeration (see profileEdgeSeeds).
    const edgeSeeds = profileEdgeSeeds(profile.face, seed, faceEdges);
    // Revolve edge history is sparse; the completed face map feeds both
    // trackedFaceIds and the history-less seeding below.
    const { edgeMap, faceMap, outputFaces } = completeTrackedHistory([profile.face], result.value, {
        inputEdges: faceEdges,
        inputFaces: [profile.face],
    });
    // Side faces generated from profile edges take the edge's seed (see extrude).
    const faceIds = trackedFaceIds(feature.id, [seed], edgeSeeds, faceMap, result.value.faceEdgeMap);
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
    return Result.ok({
        shape: result.value.shape,
        faceIds,
        edgeIds: trackedIds(feature.id, edgeSeeds, edgeMap),
    });
}

/**
 * Seeds the faces the kernel's revolve history does not report. Two are missing by construction:
 * a partial revolve's end cap, and a full turn's end rings (the flange faces an
 * axis-perpendicular profile edge sweeps at 360°). Left alone they would take positional ids
 * that realign onto another face when the profile's structure changes.
 *
 * - **Authoritative first.** The kernel reports a partial revolve's end cap directly through
 *   `capFaces` (the sweep's LastShape), so nothing else runs when it is present.
 * - **Otherwise seed from the profile geometry.** A full turn reports nothing (first and last
 *   shapes coincide), and a kernel predating the channel reports nothing either. Then: the
 *   single history-less face of a partial revolve is the end cap; otherwise each face takes the
 *   seeds of the profile edges lying on its surface (a full-turn ring contains the input edge
 *   that swept it), compounding when a merged ring carries several. Only the edge midpoint is
 *   probed — the endpoints are shared with the neighboring edge's surface.
 * - **Faces no edge claims** keep the positional fallback.
 */
function seedHistoryLessFaces(
    faces: IFace[],
    faceIds: string[],
    faceMap: number[],
    faceEdgeMap: number[] | undefined,
    faceEdges: IEdge[],
    edgeSeeds: string[],
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
        const claims = edgeSeeds.filter((_, edgeIndex) => {
            const edge = faceEdges[edgeIndex];
            const mid = edge.pointAt((edge.firstParameter() + edge.lastParameter()) / 2);
            return surface.parameter(mid, MATCH_TOLERANCE) !== undefined;
        });
        if (claims.length > 0) faceIds[index] = combineIds(claims);
    }
}

registerFeature("revolve", revolveHandler);
