// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IShape, Result, ShapeTypes, type XYZ } from "@chili3d/core";
import { SketchNode } from "../sketch/sketchNode";
import { resolveNumber } from "./expression";
import {
    type ExtrudeFeatureData,
    type FeatureHandler,
    registerFeature,
    type ShapeTracking,
    trackedIds,
} from "./feature";
import { sketchFaces, sketchShapeEach } from "./profileBuilder";

export function findSketch(document: IDocument, id: string): SketchNode | undefined {
    const node = document.modelManager.findNode((n) => n.id === id);
    return node instanceof SketchNode ? node : undefined;
}

const extrudeHandler: FeatureHandler<ExtrudeFeatureData> = {
    display: "command.feature.extrude",
    icon: "icon-prism",

    nodeIds: (feature) => [feature.sketchId],

    parameters: (feature) => [{ key: "length", display: "common.length", value: feature.length }],

    setParameter: (feature, key, value) => ({ ...feature, [key]: value }),

    evaluate(feature, context): Result<IShape> {
        const sketch = findSketch(context.document, feature.sketchId);
        if (sketch === undefined) return Result.err("Sketch not found");

        const length = resolveNumber(feature.length, context.scope);
        if (!length.isOk) return Result.err(length.error);
        const vec = sketch.plane.normal.multiply(length.value);
        const tracking = context.tracking;
        if (tracking === undefined || shapeFactory.prismTracked === undefined) {
            return sketchShapeEach(sketch, (face) => shapeFactory.prism(face, vec));
        }
        return extrudeTracked(feature, sketch, vec, tracking);
    },
};

function extrudeTracked(
    feature: ExtrudeFeatureData,
    sketch: SketchNode,
    vec: XYZ,
    tracking: ShapeTracking,
): Result<IShape> {
    const faces = sketchFaces(sketch);
    if (!faces.isOk) return Result.err(faces.error);
    const shapes: IShape[] = [];
    const outputFaceIds: string[] = [];
    const outputEdgeIds: string[] = [];
    for (const [index, face] of faces.value.entries()) {
        const result = shapeFactory.prismTracked!(face, vec);
        if (!result.isOk) return Result.err(result.error);
        shapes.push(result.value.shape);
        // Each profile face seeds one id; prism history propagates it to the side/top faces.
        outputFaceIds.push(...trackedIds(feature.id, [`sketch:${sketch.id}:${index}`], result.value.faceMap));
        // Profile edges seed sketch-scoped ids (the prism's bottom edges are identical
        // to them); edges the sweep history does not cover get feature-scoped ids.
        const edgeSeeds = face
            .findSubShapes(ShapeTypes.edge)
            .map((_, edgeIndex) => `sketch:${sketch.id}:${index}:e${edgeIndex}`);
        outputEdgeIds.push(...trackedIds(feature.id, edgeSeeds, result.value.edgeMap));
    }
    tracking.outputFaceIds = outputFaceIds;
    tracking.outputEdgeIds = outputEdgeIds;
    return shapes.length === 1 ? Result.ok(shapes[0]) : shapeFactory.combine(shapes);
}

registerFeature("extrude", extrudeHandler);
