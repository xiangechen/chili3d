// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../../config";
import { I18n } from "../../i18n";
import { type IFace, ShapeTypes } from "../../shape";
import { ObjectSnapTypes, ObjectSnapTypeUtils } from "../../snapType";
import type { ISnap, MouseAndDetected, SnapResult } from "../snap";

export class SurfaceSnap implements ISnap {
    snap(data: MouseAndDetected): SnapResult | undefined {
        if (!ObjectSnapTypeUtils.hasType(Config.instance.snapType, ObjectSnapTypes.onSurface))
            return undefined;

        const shapes = data.view.detectShapes(ShapeTypes.face, data.mx, data.my);
        if (shapes.length === 0) {
            return undefined;
        }
        return {
            shapes,
            point: (shapes[0].shape.transformedMul(shapes[0].transform) as IFace)
                .surface()
                .project(shapes[0].point!)[0],
            view: data.view,
            info: I18n.translate("snap.onSurface"),
            type: "onSurface",
        };
    }

    removeDynamicObject(): void {}
    clear(): void {}
}
