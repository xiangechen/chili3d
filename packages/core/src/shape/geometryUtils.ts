// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Precision, Result } from "../foundation";
import { Plane, XYZ } from "../math";
import { CurveUtils, type ICurve } from "./curve";
import type { IEdge, IFace, IWire } from "./shape";
import { ShapeTypes } from "./shapeType";

const FACE_NORMAL_SAMPLE_UV: readonly [number, number][] = [
    [0.5, 0.5],
    [0.25, 0.25],
    [0.75, 0.75],
    [0.25, 0.75],
    [0.75, 0.25],
];

export class GeometryUtils {
    static nearestPoint(wire: IWire, point: XYZ): { edge: IEdge; point: XYZ; parameter: number } {
        let minDistance = Number.MAX_VALUE;
        let nearest: { edge: IEdge; point: XYZ; parameter: number } | undefined;

        for (const edge of wire.findSubShapes(ShapeTypes.edge) as IEdge[]) {
            const tempPoint = edge.curve.nearestFromPoint(point);
            if (tempPoint.distance < minDistance) {
                nearest = { edge, point: tempPoint.point, parameter: tempPoint.parameter };
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
        return vec.cross(XYZ.unitX).normalize() ?? XYZ.unitZ;
    }

    private static wireNormal(wire: IWire): XYZ {
        const edges = wire.findSubShapes(ShapeTypes.edge) as IEdge[];
        if (edges.length === 0) {
            console.warn("Empty wire");
            return XYZ.unitZ;
        } else if (edges.length === 1) {
            return GeometryUtils.curveNormal(edges[0].curve);
        }

        // The first edge pair can be degenerate (parallel edges, a closed first edge,
        // zero-length endpoints), so try every adjacent pair and fall back to the
        // first edge's curve normal (e.g. the axis of a circular edge).
        const normal = GeometryUtils.wireNormalFromEdges(edges) ?? GeometryUtils.curveNormal(edges[0].curve);
        if (wire.orientation() === "reversed") {
            return normal.reverse();
        }
        return normal;
    }

    private static wireNormalFromEdges(edges: IEdge[]): XYZ | undefined {
        const spans = edges.map((edge) => {
            const [start, end] = edge.ends();
            return { start, direction: end.sub(start) };
        });

        for (let i = 0; i < spans.length - 1; i++) {
            const normal = spans[i].direction.cross(spans[i + 1].direction).normalize();
            if (normal) return normal;

            // Parallel but distinct lines still define a plane: use the vector
            // connecting their start points as the second direction.
            const between = spans[i + 1].start.sub(spans[i].start);
            const planeNormal = spans[i].direction.cross(between).normalize();
            if (planeNormal) return planeNormal;
        }
        return undefined;
    }

    static isCCW(normal: XYZ, wire: IWire): boolean {
        const testNormal = GeometryUtils.wireNormal(wire);
        return testNormal.dot(normal) > 0.001;
    }

    static findNextEdge(wire: IWire, edge: IEdge): Result<IEdge> {
        const curve = edge.curve;
        const wireEndParam =
            edge.orientation() === "reversed" ? curve.firstParameter() : curve.lastParameter();
        const point = curve.value(wireEndParam);

        for (const e of wire.findSubShapes(ShapeTypes.edge)) {
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

    /**
     * The plane a face lies in, anchored at the face's parameter origin. The x
     * direction is world X where the face allows it and derived from world Z where
     * it does not, so a horizontal face keeps the axes a drawing would expect.
     */
    static planeFromFace(face: IFace): Plane {
        const [point, normal] = face.normal(0, 0);
        let xvec = XYZ.unitX;
        if (!normal.isParallelTo(XYZ.unitZ)) {
            xvec = XYZ.unitZ.cross(normal).normalize() ?? XYZ.unitX;
        }
        return new Plane({ origin: point, normal, xvec });
    }

    static normal(shape: IFace | IWire | IEdge): XYZ {
        if (shape.shapeType === ShapeTypes.face) {
            // The UV midpoint can be a surface singularity (zero normal), sample a few
            // fallback parameters before giving up.
            const face = shape as IFace;
            for (const [u, v] of FACE_NORMAL_SAMPLE_UV) {
                const normal = face.normal(u, v)[1].normalize();
                if (normal) return normal;
            }
            console.warn("Cannot compute face normal, fallback to unitZ");
            return XYZ.unitZ;
        }

        if (shape.shapeType === ShapeTypes.edge) {
            const curve = (shape as IEdge).curve;
            return GeometryUtils.curveNormal(curve);
        }

        return GeometryUtils.wireNormal(shape as IWire);
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
