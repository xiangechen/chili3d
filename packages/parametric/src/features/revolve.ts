// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Line, Result, XYZ } from "@chili3d/core";
import { resolveNumber } from "./expression";
import { findSketch } from "./extrude";
import { type FeatureHandler, type RevolveFeatureData, registerFeature } from "./feature";
import { sketchShapeEach } from "./profileBuilder";

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
        return sketchShapeEach(sketch, (face) => shapeFactory.revolve(face, axis, angle.value));
    },
};

registerFeature("revolve", revolveHandler);
