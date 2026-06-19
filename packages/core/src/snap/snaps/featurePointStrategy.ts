// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys } from "../../i18n";
import { MathUtils, type XYZ } from "../../math";
import { CurveUtils, type IEdge, type ITrimmedCurve, type IVertex, ShapeTypes } from "../../shape";
import { type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "../../snapType";
import type { IView, VisualShapeData } from "../../visual";
import type { SnapResult, SnapType } from "../snap";

export class FeaturePointStrategy {
    private readonly _featureInfos: Map<VisualShapeData, SnapResult[]> = new Map();

    constructor(
        private _snapType: ObjectSnapType,
        private refPoint?: () => XYZ,
    ) {}

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
        if (this.refPoint && ObjectSnapTypeUtils.hasType(this._snapType, ObjectSnapTypes.tangent)) {
            this.getTangent(curve, this.refPoint()).forEach((tangent) => {
                addPoint(tangent, "snap.tangent", "tangent");
            });
        }
    }

    private getTangent(curve: ITrimmedCurve, point: XYZ) {
        const points: XYZ[] = [];
        if (
            CurveUtils.isCircle(curve.basisCurve) &&
            MathUtils.almostEqual(point.sub(curve.basisCurve.center).dot(curve.basisCurve.axis), 0)
        ) {
            const { center, radius, axis } = curve.basisCurve;

            const V = point.sub(center);
            const d = V.length();
            if (d <= radius) {
                return points;
            }

            // cos(α) = r / d, where α is the half-angle between the two tangent directions
            const alpha = Math.acos(radius / d);

            // Unit vector from center toward the external point
            const unitV = V.normalize();
            if (!unitV) return points;

            // Rotate unitV by ±α around the circle axis to get the tangent-point directions
            const dir1 = unitV.rotate(axis, alpha);
            const dir2 = unitV.rotate(axis, -alpha);
            if (dir1) {
                points.push(center.add(dir1.multiply(radius)));
            }
            if (dir2) {
                points.push(center.add(dir2.multiply(radius)));
            }
        }
        return points;
    }

    clear(): void {
        this._featureInfos.clear();
    }

    updateSnapType(snapType: ObjectSnapType): void {
        this._snapType = snapType;
        this.clear();
    }
}
