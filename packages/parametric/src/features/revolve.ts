// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    Line,
    Result,
    ShapeNode,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { completeEdgeHistory, MATCH_TOLERANCE, matchEdgeIndexes } from "./edgeRef";
import { resolveNumber } from "./expression";
import { findSketch } from "./extrude";
import {
    combineIds,
    type FeatureHandler,
    type RevolveFeatureData,
    registerFeature,
    type ShapeTracking,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { type ResolvedProfile, resolveProfiles } from "./profileBuilder";

const revolveHandler: FeatureHandler<RevolveFeatureData> = {
    display: "command.feature.revolve",
    icon: "icon-revolve",

    nodeIds: (feature) =>
        feature.axisSource === undefined || feature.axisSource.nodeId === feature.sketchId
            ? [feature.sketchId]
            : [feature.sketchId, feature.axisSource.nodeId],

    parameters: (feature) => [{ key: "angle", display: "common.angle", value: feature.angle }],

    setParameter: (feature, key, value) => ({ ...feature, [key]: value }),

    evaluate(feature, context): Result<IShape> {
        const sketch = findSketch(context.document, feature.sketchId);
        if (sketch === undefined) return Result.err("Sketch not found");

        const angle = resolveNumber(feature.angle, context.scope);
        if (!angle.isOk) return Result.err(angle.error);
        const axis = resolveAxis(feature, context.document);
        const profiles = resolveProfiles(sketch, feature.profiles);
        if (!profiles.isOk) return Result.err(profiles.error);
        const tracking = context.tracking;
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
 * The axis as a live reference: the fingerprinted edge is re-matched against the
 * source node's current shape, so editing the picked axis line moves the revolve.
 * Falls back to the world-space snapshot when the source is gone or no longer
 * matches a single line edge.
 */
function resolveAxis(feature: RevolveFeatureData, document: IDocument): Line {
    const fallback = new Line({
        point: new XYZ(feature.axis.point),
        direction: new XYZ(feature.axis.direction),
    });
    const source = feature.axisSource;
    if (source === undefined) return fallback;

    const node = document.modelManager.findNode((n) => n.id === source.nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return fallback;

    const edges = node.shape.value.findSubShapes(ShapeTypes.edge) as IEdge[];
    const matched = matchEdgeIndexes(node.shape.value, [source.edge]);
    if (!matched.isOk) return fallback;

    const edge = edges[matched.value[0]];
    const basis = edge.curve.basisCurve;
    if (!CurveUtils.isLine(basis)) return fallback;

    const world = node.worldTransform();
    return new Line({
        point: world.ofPoint(edge.startPoint()),
        direction: world.ofVector(basis.direction),
    });
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
    const edgeSeeds = faceEdges.map((_, edgeIndex) => `${seed}:e${edgeIndex}`);
    // Revolve edge history is sparse; geometry-identical completion recovers the
    // unchanged edges it missed, the rest get feature-scoped ids.
    const edgeMap = completeEdgeHistory(
        faceEdges,
        result.value.shape.findSubShapes(ShapeTypes.edge) as IEdge[],
        result.value.edgeMap,
    );
    // Side faces generated from profile edges take the edge's seed (see extrude).
    const faceIds = trackedFaceIds(
        feature.id,
        [seed],
        edgeSeeds,
        result.value.faceMap,
        result.value.faceEdgeMap,
    );
    seedHistoryLessFaces(
        result.value.shape.findSubShapes(ShapeTypes.face) as IFace[],
        faceIds,
        result.value.faceMap,
        result.value.faceEdgeMap,
        faceEdges,
        edgeSeeds,
        seed,
    );
    return Result.ok({
        shape: result.value.shape,
        faceIds,
        edgeIds: trackedIds(feature.id, edgeSeeds, edgeMap),
    });
}

/**
 * The kernel's revolve history never reports the end cap of a partial revolve, and
 * drops the end rings of a full turn (the flange faces an axis-perpendicular profile
 * edge sweeps at 360°) — both would otherwise get positional ids that realign onto
 * another face when the profile's structure changes. Seed them from the profile
 * geometry instead: the single history-less face of a partial revolve is the end
 * cap; otherwise each face takes the seeds of the profile edges lying on its surface
 * (a full-turn ring contains the input edge that swept it), compounding when a
 * merged ring carries several. Only the edge midpoint is probed — the endpoints are
 * shared with the neighboring edge's surface. Faces no edge claims keep the
 * positional fallback.
 */
function seedHistoryLessFaces(
    faces: IFace[],
    faceIds: string[],
    faceMap: number[],
    faceEdgeMap: number[] | undefined,
    faceEdges: IEdge[],
    edgeSeeds: string[],
    seed: string,
): void {
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
