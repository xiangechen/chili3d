// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ICurve, IEdge, IFace, IWire, Precision, Result, ShapeType, XYZ } from "chili-core";

export class GeoUtils {
    static nearestPoint(wire: IWire, point: XYZ): { edge: IEdge; point: XYZ } {
        let res: { edge: IEdge; point: XYZ } | undefined = undefined;
        let minDistance = Number.MAX_VALUE;
        for (const edge of wire.findSubShapes(ShapeType.Edge) as IEdge[]) {
            let tempPoint = edge.asCurve().unwrap().nearestPoint(point);
            let tempDistance = tempPoint.distanceTo(point);
            if (tempDistance < minDistance) {
                res = { edge, point: tempPoint };
                minDistance = tempDistance;
            }
        }
        return res!;
    }

    private static curveNormal = (curve: ICurve) => {
        if (ICurve.isConic(curve)) {
            return curve.plane.normal;
        }
        let vec = curve.dn(0, 1);
        if (vec.isParallelTo(XYZ.unitX)) return XYZ.unitZ;
        return vec.cross(XYZ.unitX).normalize()!;
    };

    private static wireNormal = (wire: IWire) => {
        let face = wire.toFace();
        if (face.isOk) {
            return face.unwrap().normal(0, 0)[1];
        }

        let firstEdge: IEdge | undefined = undefined;
        for (const edge of wire.iterSubShapes(ShapeType.Edge, true)) {
            firstEdge = edge as IEdge;
            break;
        }
        return this.curveNormal(firstEdge!.asCurve().unwrap());
    };

    static findNextEdge(wire: IWire, edge: IEdge): Result<IEdge> {
        let curve = edge.asCurve().unwrap();
        let point = curve.point(curve.lastParameter());
        for (const e of wire.iterSubShapes(ShapeType.Edge, true)) {
            if (e.isEqual(edge)) continue;
            let testCurve = (e as IEdge).asCurve().unwrap();
            if (
                point.distanceTo(testCurve.point(testCurve.firstParameter())) < Precision.Distance ||
                point.distanceTo(testCurve.point(testCurve.lastParameter())) < Precision.Distance
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
            let curve = (shape as IEdge).asCurve().unwrap();
            return this.curveNormal(curve);
        }

        return this.wireNormal(shape as IWire);
    }
}
