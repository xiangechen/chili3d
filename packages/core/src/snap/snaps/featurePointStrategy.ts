// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys } from "../../i18n";
import type { XYZ } from "../../math";
import { type IEdge, type IVertex, ShapeTypes } from "../../shape";
import { type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "../../snapType";
import type { IView, VisualShapeData } from "../../visual";
import type { SnapResult, SnapType } from "../snap";

export class FeaturePointStrategy {
    private readonly _featureInfos: Map<VisualShapeData, SnapResult[]> = new Map();

    constructor(private _snapType: ObjectSnapType) {}

    getFeaturePoints(view: IView, shape: VisualShapeData): SnapResult[] {
        if (this._featureInfos.has(shape)) {
            return this._featureInfos.get(shape)!;
        }

        const infos: SnapResult[] = [];
        if (shape.shape.shapeType === ShapeTypes.vertex) {
            this.getVertexFeaturePoints(view, shape, infos);
        } else if (shape.shape.shapeType === ShapeTypes.edge) {
            this.getEdgeFeaturePoints(view, shape, infos);
        }
        this._featureInfos.set(shape, infos);
        return infos;
    }

    private getVertexFeaturePoints(view: IView, shape: VisualShapeData, infos: SnapResult[]) {
        if (ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.vertex)) {
            const point = shape.transform.ofPoint((shape.shape as IVertex).point());
            infos.push({
                view,
                point,
                info: I18n.translate("vertex.point"),
                shapes: [shape],
                type: "vertex",
            });
        }
    }

    private getEdgeFeaturePoints(view: IView, shape: VisualShapeData, infos: SnapResult[]) {
        const curve = (shape.shape as IEdge).curve;
        const start = curve.value(curve.firstParameter());
        const end = curve.value(curve.lastParameter());

        const addPoint = (point: XYZ, info: I18nKeys, type: SnapType) =>
            infos.push({
                view,
                point: shape.transform.ofPoint(point),
                type,
                info: I18n.translate(info),
                shapes: [shape],
            });

        if (ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.endPoint)) {
            addPoint(start, "snap.end", "end");
            addPoint(end, "snap.end", "end");
        }
        if (ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.midPoint)) {
            const mid = curve.value((curve.firstParameter() + curve.lastParameter()) * 0.5);
            addPoint(mid, "snap.mid", "middle");
        }
    }

    clear(): void {
        this._featureInfos.clear();
    }

    updateSnapType(snapType: ObjectSnapType): void {
        this._snapType = snapType;
        this.clear();
    }
}
