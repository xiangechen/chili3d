// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Line, Result, ShapeTypes, XYZ } from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
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

    nodeIds: (feature) => [feature.sketchId],

    parameters: (feature) => [{ key: "angle", display: "common.angle", value: feature.angle }],

    setParameter: (feature, key, value) => ({ ...feature, [key]: value }),

    evaluate(feature, context): Result<IShape> {
        const sketch = findSketch(context.document, feature.sketchId);
        if (sketch === undefined) return Result.err("Sketch not found");

        const angle = resolveNumber(feature.angle, context.scope);
        if (!angle.isOk) return Result.err(angle.error);
        const axis = new Line({
            point: new XYZ(feature.axis.point),
            direction: new XYZ(feature.axis.direction),
        });
        const profiles = resolveProfiles(sketch);
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
