// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CurveUtils, type IEdge, type IShape, type IShapeFilter, ShapeTypes } from "@chili3d/core";

/** Admits only line edges — the revolve axis pick, the pattern direction/axis pick. */
export class LineEdgeFilter implements IShapeFilter {
    allow(shape: IShape): boolean {
        if (shape.shapeType !== ShapeTypes.edge) return false;
        return CurveUtils.isLine((shape as IEdge).curve.basisCurve);
    }
}

/**
 * Admits line and circular edges — a point-normal plane takes its normal from either a
 * straight edge's direction or a circle's axis.
 */
export class LineOrCircleEdgeFilter implements IShapeFilter {
    allow(shape: IShape): boolean {
        if (shape.shapeType !== ShapeTypes.edge) return false;
        const basis = (shape as IEdge).curve.basisCurve;
        return CurveUtils.isLine(basis) || CurveUtils.isCircle(basis);
    }
}
