// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ICurve, IEdge, IFace, IWire, Precision, Result, ShapeType, XYZ } from "chili-core";

export class GeoUtils {
    static nearestPoint(wire: IWire, point: XYZ): { edge: IEdge; point: XYZ } {
        let minDistance = Number.MAX_VALUE;
        let nearest: { edge: IEdge; point: XYZ } | undefined;

        for (const edge of wire.findSubShapes(ShapeType.Edge) as IEdge[]) {
            const tempPoint = edge.curve.nearestFromPoint(point);
            if (tempPoint.distance < minDistance) {
                nearest = { edge, point: tempPoint.point };
                minDistance = tempPoint.distance;
            }
        }
        return nearest!;
    }

    static curveNormal(curve: ICurve) {
        if (ICurve.isTrimmed(curve)) {
            curve = curve.basisCurve;
        }

        if (ICurve.isConic(curve)) {
            return curve.axis;
        }
        let vec = curve.dn(0, 1);
        if (vec.isParallelTo(XYZ.unitX)) return XYZ.unitZ;
        return vec.cross(XYZ.unitX).normalize()!;
    }

    private static wireNormal(wire: IWire): XYZ {
        const face = wire.toFace();
        if (face.isOk) return face.value.normal(0, 0)[1];

        let firstEdge: IEdge | undefined = undefined;
        for (const edge of wire.findSubShapes(ShapeType.Edge)) {
            firstEdge = edge as IEdge;
            break;
        }
        return this.curveNormal(firstEdge!.curve);
    }

    static findNextEdge(wire: IWire, edge: IEdge): Result<IEdge> {
        const curve = edge.curve;
        const point = curve.value(curve.lastParameter());

        for (const e of wire.findSubShapes(ShapeType.Edge)) {
            if (e.isEqual(edge)) continue;
            const testCurve = (e as IEdge).curve;
            if (
                point.distanceTo(testCurve.value(testCurve.firstParameter())) < Precision.Distance ||
                point.distanceTo(testCurve.value(testCurve.lastParameter())) < Precision.Distance
            ) {
                return Result.ok(e as IEdge);
            }
        }
        return Result.err("Cannot find next edge");
    }

    static normal(shape: IFace | IWire | IEdge): XYZ {
        if (shape.shapeType === ShapeType.Face) {
            return (shape as IFace).normal(0, 0)[1];
        }

        if (shape.shapeType === ShapeType.Edge) {
            let curve = (shape as IEdge).curve;
            return this.curveNormal(curve);
        }

        return this.wireNormal(shape as IWire);
    }

    static intersects(edge: IEdge, otherEdges: IEdge[]): { point: XYZ; parameter: number }[] {
        let result: { point: XYZ; parameter: number }[] = [];
        otherEdges.forEach((e) => {
            let intersect = edge.intersect(e);
            if (intersect.length > 0) {
                result.push(...intersect);
            }
        });
        return result;
    }
}
