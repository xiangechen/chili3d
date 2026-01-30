// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Continuity,
    CurveType,
    gc,
    JoinType,
    type Line,
    Matrix4,
    Orientation,
    Plane,
    ShapeType,
    SurfaceType,
    XYZ,
} from "chili-core";
import type {
    GeomAbs_Shape,
    gp_Ax1,
    gp_Ax2,
    gp_Ax3,
    gp_Dir,
    gp_Pln,
    gp_Pnt,
    gp_Trsf,
    gp_Vec,
    TopAbs_ShapeEnum,
    TopoDS_Shape,
    Vector3,
} from "../lib/chili-wasm";

export function toXYZ(p: gp_Pnt | gp_Dir | gp_Vec | Vector3): XYZ {
    return new XYZ(p.x, p.y, p.z);
}

export function toDir(value: Vector3) {
    return new wasm.gp_Dir(value.x, value.y, value.z);
}

export function toPnt(value: Vector3) {
    return new wasm.gp_Pnt(value.x, value.y, value.z);
}

export function toVec(value: Vector3) {
    return new wasm.gp_Vec(value.x, value.y, value.z);
}

export function toAx1(ray: Line): gp_Ax1 {
    return gc((c) => {
        return new wasm.gp_Ax1(c(toPnt(ray.point)), c(toDir(ray.direction)));
    });
}

export function toAx2(plane: Plane): gp_Ax2 {
    return gc((c) => {
        return new wasm.gp_Ax2(c(toPnt(plane.origin)), c(toDir(plane.normal)), c(toDir(plane.xvec)));
    });
}

export function toAx3(plane: Plane): gp_Ax3 {
    return new wasm.gp_Ax3(toPnt(plane.origin), toDir(plane.normal), toDir(plane.xvec));
}

export function fromAx23(ax: gp_Ax2 | gp_Ax3): Plane {
    return gc((c) => {
        return new Plane(toXYZ(c(ax.location())), toXYZ(c(ax.direction())), toXYZ(c(ax.xDirection())));
    });
}

export function fromPln(pln: gp_Pln): Plane {
    return gc((c) => {
        const ax3 = c(pln.position());
        return fromAx23(ax3);
    });
}

export function toPln(plane: Plane): gp_Pln {
    return gc((c) => {
        return new wasm.gp_Pln(c(toAx3(plane)));
    });
}

export function convertFromMatrix(matrix: Matrix4): gp_Trsf {
    const arr = matrix.toArray();
    const trsf = new wasm.gp_Trsf();
    trsf.setValues(
        arr[0],
        arr[4],
        arr[8],
        arr[12],
        arr[1],
        arr[5],
        arr[9],
        arr[13],
        arr[2],
        arr[6],
        arr[10],
        arr[14],
    );
    return trsf;
}

export function convertToMatrix(matrix: gp_Trsf): Matrix4 {
    const arr: number[] = [
        matrix.value(1, 1),
        matrix.value(2, 1),
        matrix.value(3, 1),
        0,
        matrix.value(1, 2),
        matrix.value(2, 2),
        matrix.value(3, 2),
        0,
        matrix.value(1, 3),
        matrix.value(2, 3),
        matrix.value(3, 3),
        0,
        matrix.value(1, 4),
        matrix.value(2, 4),
        matrix.value(3, 4),
        1,
    ];
    return Matrix4.fromArray(arr);
}

export function getOrientation(shape: TopoDS_Shape): Orientation {
    switch (shape.getOrientation()) {
        case wasm.TopAbs_Orientation.TopAbs_FORWARD:
            return Orientation.FORWARD;
        case wasm.TopAbs_Orientation.TopAbs_REVERSED:
            return Orientation.REVERSED;
        case wasm.TopAbs_Orientation.TopAbs_INTERNAL:
            return Orientation.INTERNAL;
        case wasm.TopAbs_Orientation.TopAbs_EXTERNAL:
            return Orientation.EXTERNAL;
        default:
            return Orientation.FORWARD;
    }
}

export function getShapeType(shape: TopoDS_Shape): ShapeType {
    if (shape.isNull()) {
        throw new Error("Shape is null");
    }

    switch (shape.shapeType()) {
        case wasm.TopAbs_ShapeEnum.TopAbs_COMPOUND:
            return ShapeType.Compound;
        case wasm.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
            return ShapeType.CompoundSolid;
        case wasm.TopAbs_ShapeEnum.TopAbs_SOLID:
            return ShapeType.Solid;
        case wasm.TopAbs_ShapeEnum.TopAbs_SHELL:
            return ShapeType.Shell;
        case wasm.TopAbs_ShapeEnum.TopAbs_FACE:
            return ShapeType.Face;
        case wasm.TopAbs_ShapeEnum.TopAbs_WIRE:
            return ShapeType.Wire;
        case wasm.TopAbs_ShapeEnum.TopAbs_EDGE:
            return ShapeType.Edge;
        case wasm.TopAbs_ShapeEnum.TopAbs_VERTEX:
            return ShapeType.Vertex;
        default:
            return ShapeType.Shape;
    }
}

export function getShapeEnum(shapeType: ShapeType): TopAbs_ShapeEnum {
    switch (shapeType) {
        case ShapeType.Compound:
            return wasm.TopAbs_ShapeEnum.TopAbs_COMPOUND;
        case ShapeType.CompoundSolid:
            return wasm.TopAbs_ShapeEnum.TopAbs_COMPSOLID;
        case ShapeType.Solid:
            return wasm.TopAbs_ShapeEnum.TopAbs_SOLID;
        case ShapeType.Shell:
            return wasm.TopAbs_ShapeEnum.TopAbs_SHELL;
        case ShapeType.Face:
            return wasm.TopAbs_ShapeEnum.TopAbs_FACE;
        case ShapeType.Wire:
            return wasm.TopAbs_ShapeEnum.TopAbs_WIRE;
        case ShapeType.Edge:
            return wasm.TopAbs_ShapeEnum.TopAbs_EDGE;
        case ShapeType.Vertex:
            return wasm.TopAbs_ShapeEnum.TopAbs_VERTEX;
        case ShapeType.Shape:
            return wasm.TopAbs_ShapeEnum.TopAbs_SHAPE;
        default:
            throw new Error("Unknown shape type: " + shapeType);
    }
}

export function getActualShape(shape: TopoDS_Shape): TopoDS_Shape {
    if (shape.isNull()) {
        throw new Error("Shape is null");
    }

    switch (shape.shapeType()) {
        case wasm.TopAbs_ShapeEnum.TopAbs_COMPOUND:
            return wasm.TopoDS.compound(shape);
        case wasm.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
            return wasm.TopoDS.compsolid(shape);
        case wasm.TopAbs_ShapeEnum.TopAbs_SOLID:
            return wasm.TopoDS.solid(shape);
        case wasm.TopAbs_ShapeEnum.TopAbs_SHELL:
            return wasm.TopoDS.shell(shape);
        case wasm.TopAbs_ShapeEnum.TopAbs_FACE:
            return wasm.TopoDS.face(shape);
        case wasm.TopAbs_ShapeEnum.TopAbs_WIRE:
            return wasm.TopoDS.wire(shape);
        case wasm.TopAbs_ShapeEnum.TopAbs_EDGE:
            return wasm.TopoDS.edge(shape);
        case wasm.TopAbs_ShapeEnum.TopAbs_VERTEX:
            return wasm.TopoDS.vertex(shape);
        default:
            return shape;
    }
}

export function getJoinType(joinType: JoinType) {
    switch (joinType) {
        case JoinType.arc:
            return wasm.GeomAbs_JoinType.GeomAbs_Arc;
        case JoinType.intersection:
            return wasm.GeomAbs_JoinType.GeomAbs_Intersection;
        case JoinType.tangent:
            return wasm.GeomAbs_JoinType.GeomAbs_Tangent;
        default:
            throw new Error("Unknown join type: " + joinType);
    }
}

export function getCurveType(curve: any): CurveType {
    const isType = (type: string) => wasm.Transient.isInstance(curve, type);
    if (isType("Geom_Line")) return CurveType.Line;
    else if (isType("Geom_Circle")) return CurveType.Circle;
    else if (isType("Geom_Ellipse")) return CurveType.Ellipse;
    else if (isType("Geom_Hyperbola")) return CurveType.Hyperbola;
    else if (isType("Geom_Parabola")) return CurveType.Parabola;
    else if (isType("Geom_BezierCurve")) return CurveType.BezierCurve;
    else if (isType("Geom_BSplineCurve")) return CurveType.BSplineCurve;
    else if (isType("Geom_OffsetCurve")) return CurveType.OffsetCurve;
    else if (isType("Geom_TrimmedCurve")) return CurveType.TrimmedCurve;

    throw new Error("Unknown curve type");
}

export function getSurfaceType(surface: any): SurfaceType {
    const isType = (type: string) => wasm.Transient.isInstance(surface, type);
    if (isType("GeomPlate_Surface")) return SurfaceType.Plate;
    else if (isType("Geom_Plane")) return SurfaceType.Plane;
    else if (isType("Geom_SurfaceOfLinearExtrusion")) return SurfaceType.Extrusion;
    else if (isType("Geom_SurfaceOfRevolution")) return SurfaceType.Revolution;
    else if (isType("Geom_OffsetSurface")) return SurfaceType.Offset;
    else if (isType("Geom_BSplineSurface")) return SurfaceType.BSpline;
    else if (isType("Geom_BezierSurface")) return SurfaceType.Bezier;
    else if (isType("Geom_CylindricalSurface")) return SurfaceType.Cylinder;
    else if (isType("Geom_ConicalSurface")) return SurfaceType.Conical;
    else if (isType("Geom_SphericalSurface")) return SurfaceType.Spherical;
    else if (isType("Geom_RectangularTrimmedSurface")) return SurfaceType.RectangularTrimmed;
    else if (isType("Geom_ToroidalSurface")) return SurfaceType.Toroidal;
    else if (isType("ShapeExtent_CompositeSurface")) return SurfaceType.Composite;

    throw new Error("Unknown surface type");
}

export function convertToContinuity(cni: GeomAbs_Shape) {
    switch (cni) {
        case wasm.GeomAbs_Shape.GeomAbs_C0:
            return Continuity.C0;
        case wasm.GeomAbs_Shape.GeomAbs_G1:
            return Continuity.G1;
        case wasm.GeomAbs_Shape.GeomAbs_C1:
            return Continuity.C1;
        case wasm.GeomAbs_Shape.GeomAbs_G2:
            return Continuity.G2;
        case wasm.GeomAbs_Shape.GeomAbs_C2:
            return Continuity.C2;
        case wasm.GeomAbs_Shape.GeomAbs_C3:
            return Continuity.C3;
        case wasm.GeomAbs_Shape.GeomAbs_CN:
            return Continuity.CN;
        default:
            throw new Error("unknown continuity");
    }
}

export function convertFromContinuity(continuity: Continuity) {
    switch (continuity) {
        case Continuity.C0:
            return wasm.GeomAbs_Shape.GeomAbs_C0;
        case Continuity.G1:
            return wasm.GeomAbs_Shape.GeomAbs_G1;
        case Continuity.C1:
            return wasm.GeomAbs_Shape.GeomAbs_C1;
        case Continuity.G2:
            return wasm.GeomAbs_Shape.GeomAbs_G2;
        case Continuity.C2:
            return wasm.GeomAbs_Shape.GeomAbs_C2;
        case Continuity.C3:
            return wasm.GeomAbs_Shape.GeomAbs_C3;
        case Continuity.CN:
            return wasm.GeomAbs_Shape.GeomAbs_CN;
        default:
            throw new Error("unknown continuity");
    }
}
