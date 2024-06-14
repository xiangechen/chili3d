// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ICurve, IEdge, IFace, IWire, Precision, Result, ShapeType, XYZ } from "chili-core";

export class GeoUtils {
    static nearestPoint(wire: IWire, point: XYZ): { edge: IEdge; point: XYZ } {
        let res: { edge: IEdge; point: XYZ } | undefined = undefined;
        let minDistance = Number.MAX_VALUE;
        for (const edge of wire.findSubShapes(ShapeType.Edge) as IEdge[]) {
            let tempPoint = edge.curve().nearestPoint(point);
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
            return curve.axis;
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
        return this.curveNormal(firstEdge!.curve());
    };

    static findNextEdge(wire: IWire, edge: IEdge): Result<IEdge> {
        let curve = edge.curve();
        let point = curve.value(curve.lastParameter());
        for (const e of wire.iterSubShapes(ShapeType.Edge, true)) {
            if (e.isEqual(edge)) continue;
            let testCurve = (e as IEdge).curve();
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
            let curve = (shape as IEdge).curve();
            return this.curveNormal(curve);
        }

        return this.wireNormal(shape as IWire);
    }
}
