// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../../config";
import { I18n } from "../../i18n";
import type { XYZ } from "../../math";
import { NOT_REFERENCE_GEOMETRY_FILTER } from "../../selectionFilter";
import { type IFace, ShapeTypes } from "../../shape";
import { ObjectSnapTypes, ObjectSnapTypeUtils } from "../../snapType";
import type { VisualShapeData } from "../../visual";
import type { ISnap, MouseAndDetected, SnapResult } from "../snap";

/**
 * The picked point projected onto the face, in world space. The projection runs in the face's
 * own frame, as `findPerpendicular` and `findNearestPointAtEdgeCurve` do: transforming the face
 * into world space goes through OCCT's `gp_Trsf`, a similarity transform, which silently
 * misplaces any face under a non-uniform scale — a snap there would hand the drawing commands a
 * point far from the face, and the line or circle would be built somewhere else.
 */
function projectOntoWorldSurface(data: VisualShapeData): XYZ | undefined {
    const transform = data.transform;
    const local = data.point === undefined ? undefined : transform.invert()?.ofPoint(data.point);
    if (local === undefined) {
        return undefined;
    }
    const projected = (data.shape as IFace).surface().project(local)[0];
    return projected === undefined ? undefined : transform.ofPoint(projected);
}

export class SurfaceSnap implements ISnap {
    snap(data: MouseAndDetected): SnapResult | undefined {
        if (!ObjectSnapTypeUtils.hasType(Config.instance.snapType, ObjectSnapTypes.onSurface))
            return undefined;

        const shapes = data.view.detectShapes(
            ShapeTypes.face,
            data.mx,
            data.my,
            undefined,
            NOT_REFERENCE_GEOMETRY_FILTER,
        );
        if (shapes.length === 0) {
            return undefined;
        }
        const point = projectOntoWorldSurface(shapes[0]);
        if (point === undefined) {
            return undefined;
        }
        return {
            shapes,
            point,
            view: data.view,
            info: I18n.translate("snap.onSurface"),
            type: "onSurface",
        };
    }

    removeDynamicObject(): void {}
    clear(): void {}
}
