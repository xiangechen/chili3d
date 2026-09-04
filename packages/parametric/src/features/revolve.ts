// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    type IDocument,
    type IEdge,
    type IShape,
    Line,
    Result,
    ShapeNode,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { matchEdgeIndexes } from "./edgeRef";
import { resolveNumber } from "./expression";
import { findSketch } from "./extrude";
import {
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
    for (const { face, index } of profiles) {
        const result = shapeFactory.revolveTracked!(face, axis, angle);
        if (!result.isOk) return Result.err(result.error);
        shapes.push(result.value.shape);
        // Revolve edge history is sparse; unmapped edges get feature-scoped ids.
        const edgeSeeds = face
            .findSubShapes(ShapeTypes.edge)
            .map((_, edgeIndex) => `sketch:${sketch.id}:${index}:e${edgeIndex}`);
        // Side faces generated from profile edges take the edge's seed (see extrude).
        outputFaceIds.push(
            ...trackedFaceIds(
                feature.id,
                [`sketch:${sketch.id}:${index}`],
                edgeSeeds,
                result.value.faceMap,
                result.value.faceEdgeMap,
            ),
        );
        outputEdgeIds.push(...trackedIds(feature.id, edgeSeeds, result.value.edgeMap));
    }
    tracking.outputFaceIds = outputFaceIds;
    tracking.outputEdgeIds = outputEdgeIds;
    return shapes.length === 1 ? Result.ok(shapes[0]) : shapeFactory.combine(shapes);
}

registerFeature("revolve", revolveHandler);
