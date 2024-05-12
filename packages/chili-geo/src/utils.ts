// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ICurve, IEdge, IWire, ShapeType, XYZ } from "chili-core";

export class GeoUtils {
    static nearestPoint(wire: IWire, point: XYZ): { edge: IEdge; point: XYZ } {
        let res: { edge: IEdge; point: XYZ } | undefined = undefined;
        let minDistance = Number.MAX_VALUE;
        for (const edge of wire.findSubShapes(ShapeType.Edge, true) as IEdge[]) {
            let tempPoint = edge.asCurve().unwrap().nearestPoint(point);
            let tempDistance = tempPoint.distanceTo(point);
            if (tempDistance < minDistance) {
                res = { edge, point: tempPoint };
                minDistance = tempDistance;
            }
        }
        return res!;
    }

    static normal(wire: IWire | IEdge): XYZ {
        const curveNormal = (curve: ICurve) => {
            let vec = curve.dn(0, 1);
            if (vec.isParallelTo(XYZ.unitX)) return XYZ.unitZ;
            return vec.cross(XYZ.unitX).normalize()!;
        };

        if (wire.shapeType === ShapeType.Edge) {
            let curve = (wire as IEdge).asCurve().unwrap();
            return curveNormal(curve);
        }

        let vec1: XYZ | undefined = undefined;
        let vec2: XYZ | undefined = undefined;
        let curve: ICurve | undefined = undefined;
        for (const edge of wire.iterSubShapes(ShapeType.Edge, true)) {
            if (vec1 === undefined) {
                curve = (edge as IEdge).asCurve().unwrap();
                vec1 = curve.dn(0, 1);
            } else {
                vec2 = (edge as IEdge).asCurve().unwrap().dn(0, 1);
                if (!vec1.isParallelTo(vec2)) {
                    return vec1.cross(vec2).normalize()!;
                }
            }
        }
        return curveNormal(curve!);
    }
}
