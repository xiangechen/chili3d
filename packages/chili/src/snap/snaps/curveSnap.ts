// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IEdge, ShapeType, XYZ } from "chili-core";
import { ISnap, MouseAndDetected, SnapResult } from "../snap";

export class CurveSnap implements ISnap {
    constructor(readonly referencePoint?: () => XYZ) {}

    snap(data: MouseAndDetected): SnapResult | undefined {
        if (data.shapes.length === 0 || data.shapes[0].shape.shapeType !== ShapeType.Edge) return undefined;

        const ray = data.view.rayAt(data.mx, data.my);
        const edge = data.shapes[0].shape as IEdge;
        const curve = edge.curve();
        const nearest = curve.project(ray.location);
        if (nearest.length === 0) return undefined;

        const point = nearest[0];
        return {
            view: data.view,
            point,
            info: undefined,
            shapes: [data.shapes[0]],
            refPoint: ray.location,
            distance: ray.location.distanceTo(point),
        };
    }

    removeDynamicObject(): void {}
    clear(): void {}
}
