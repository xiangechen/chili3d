// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Matrix4 } from "./math";
import { type INode, ShapeNode } from "./model";
import { CurveUtils, type IEdge, type IShape, ShapeTypes } from "./shape";

export interface IShapeFilter {
    allow(shape: IShape, transform: Matrix4): boolean;
}

export interface INodeFilter {
    allow(node: INode): boolean;
}

/**
 * Whether a node is reference geometry (a datum plane) — structural, so core need not
 * know the parametric node class. Modeling pickers, snaps and Fit exclude these.
 */
export function isReferenceGeometryNode(node: INode): boolean {
    return (node as { isReferenceGeometry?: boolean }).isReferenceGeometry === true;
}

/** The shared gate of every picker/snap that must not consume reference geometry. */
export const NOT_REFERENCE_GEOMETRY_FILTER: INodeFilter = {
    allow: (node) => !isReferenceGeometryNode(node),
};

export class ShapeNodeFilter implements INodeFilter {
    constructor(readonly shapeFilter?: IShapeFilter) {}

    allow(node: INode): boolean {
        if (node instanceof ShapeNode) {
            if (this.shapeFilter && node.shape.isOk) {
                return this.shapeFilter.allow(node.shape.value, node.transform);
            }
            return true;
        }

        return false;
    }
}

/** Admits only line edges — a revolve axis pick, a pattern direction/axis pick. */
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
