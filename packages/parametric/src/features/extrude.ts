// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IShape, Result } from "@chili3d/core";
import { SketchNode } from "../sketch/sketchNode";
import { resolveNumber } from "./expression";
import { type ExtrudeFeatureData, type FeatureHandler, registerFeature } from "./feature";
import { sketchShapeEach } from "./profileBuilder";

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
        return sketchShapeEach(sketch, (face) => shapeFactory.prism(face, vec));
    },
};

registerFeature("extrude", extrudeHandler);
