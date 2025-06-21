// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, IEdge, IView, ObjectSnapType, ShapeType, VisualShapeData, XYZ } from "chili-core";
import { SnapResult } from "../snap";

export class FeaturePointStrategy {
    private readonly _featureInfos: Map<VisualShapeData, SnapResult[]> = new Map();

    constructor(private _snapType: ObjectSnapType) {}

    getFeaturePoints(view: IView, shape: VisualShapeData): SnapResult[] {
        if (this._featureInfos.has(shape)) {
            return this._featureInfos.get(shape)!;
        }

        const infos: SnapResult[] = [];
        if (shape.shape.shapeType === ShapeType.Edge) {
            this.getEdgeFeaturePoints(view, shape, infos);
        }
        this._featureInfos.set(shape, infos);
        return infos;
    }

    private getEdgeFeaturePoints(view: IView, shape: VisualShapeData, infos: SnapResult[]) {
        const curve = (shape.shape as IEdge).curve;
        const start = curve.value(curve.firstParameter());
        const end = curve.value(curve.lastParameter());

        const addPoint = (point: XYZ, info: string) =>
            infos.push({
                view,
                point: shape.transform.ofPoint(point),
                info,
                shapes: [shape],
            });

        if (ObjectSnapType.has(this._snapType, ObjectSnapType.endPoint)) {
            addPoint(start, I18n.translate("snap.end"));
            addPoint(end, I18n.translate("snap.end"));
        }
        if (ObjectSnapType.has(this._snapType, ObjectSnapType.midPoint)) {
            const mid = curve.value((curve.firstParameter() + curve.lastParameter()) * 0.5);
            addPoint(mid, I18n.translate("snap.mid"));
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
