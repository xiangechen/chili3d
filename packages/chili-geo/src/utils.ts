// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    type ICurve,
    type IEdge,
    type IFace,
    type IWire,
    Orientation,
    Precision,
    Result,
    ShapeType,
    XYZ,
} from "chili-core";

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
        if (CurveUtils.isTrimmed(curve)) {
            curve = curve.basisCurve;
        }

        if (CurveUtils.isConic(curve)) {
            return curve.axis;
        }
        const vec = curve.dn(0, 1);
        if (vec.isParallelTo(XYZ.unitX)) return XYZ.unitZ;
        return vec.cross(XYZ.unitX).normalize()!;
    }

    private static wireNormal(wire: IWire): XYZ {
        const edges = wire.findSubShapes(ShapeType.Edge) as IEdge[];
        if (edges.length === 0) {
            console.warn("Empty wire");
            return XYZ.unitZ;
        } else if (edges.length === 1) {
            return GeoUtils.curveNormal(edges[0].curve);
        } else {
            const curve1 = edges[0].curve;
            const curve2 = edges[1].curve;
            const p1 = curve1.value(curve1.firstParameter());
            const p2 = curve1.value(curve1.lastParameter());
            const p3 = curve2.value(curve2.firstParameter());
            const p4 = curve2.value(curve2.lastParameter());
            const v1 = p2.sub(p1);
            const v2 = p4.sub(p3);
            const normal = v1.cross(v2).normalize()!;
            if (wire.orientation() === Orientation.REVERSED) {
                return normal.reverse();
            }
            return normal;
        }
    }

    static isCCW(normal: XYZ, wire: IWire): boolean {
        const testNormal = GeoUtils.wireNormal(wire);
        return testNormal.dot(normal) > 0.001;
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
            const curve = (shape as IEdge).curve;
            return GeoUtils.curveNormal(curve);
        }

        return GeoUtils.wireNormal(shape as IWire);
    }

    static intersects(edge: IEdge, otherEdges: IEdge[]): { point: XYZ; parameter: number }[] {
        const result: { point: XYZ; parameter: number }[] = [];
        otherEdges.forEach((e) => {
            const intersect = edge.intersect(e);
            if (intersect.length > 0) {
                result.push(...intersect);
            }
        });
        return result;
    }
}
