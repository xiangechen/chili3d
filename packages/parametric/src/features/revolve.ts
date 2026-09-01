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
    trackedIds,
} from "./feature";
import { sketchFaces, sketchShapeEach } from "./profileBuilder";

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
        const tracking = context.tracking;
        if (tracking === undefined || shapeFactory.revolveTracked === undefined) {
            return sketchShapeEach(sketch, (face) => shapeFactory.revolve(face, axis, angle.value));
        }
        return revolveTracked(feature, sketch, axis, angle.value, tracking);
    },
};

function revolveTracked(
    feature: RevolveFeatureData,
    sketch: SketchNode,
    axis: Line,
    angle: number,
    tracking: ShapeTracking,
): Result<IShape> {
    const faces = sketchFaces(sketch);
    if (!faces.isOk) return Result.err(faces.error);
    const shapes: IShape[] = [];
    const outputFaceIds: string[] = [];
    const outputEdgeIds: string[] = [];
    for (const [index, face] of faces.value.entries()) {
        const result = shapeFactory.revolveTracked!(face, axis, angle);
        if (!result.isOk) return Result.err(result.error);
        shapes.push(result.value.shape);
        outputFaceIds.push(...trackedIds(feature.id, [`sketch:${sketch.id}:${index}`], result.value.faceMap));
        // Revolve edge history is sparse; unmapped edges get feature-scoped ids.
        const edgeSeeds = face
            .findSubShapes(ShapeTypes.edge)
            .map((_, edgeIndex) => `sketch:${sketch.id}:${index}:e${edgeIndex}`);
        outputEdgeIds.push(...trackedIds(feature.id, edgeSeeds, result.value.edgeMap));
    }
    tracking.outputFaceIds = outputFaceIds;
    tracking.outputEdgeIds = outputEdgeIds;
    return shapes.length === 1 ? Result.ok(shapes[0]) : shapeFactory.combine(shapes);
}

registerFeature("revolve", revolveHandler);
