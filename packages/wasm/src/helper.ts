// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Continuity,
    type CurveType,
    gc,
    type JoinType,
    type Line,
    Matrix4,
    type Orientation,
    Plane,
    type ShapeType,
    ShapeTypes,
    type SurfaceType,
    XYZ,
} from "@chili3d/core";
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
    return new XYZ(p);
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
        return new Plane({
            origin: toXYZ(c(ax.location())),
            normal: toXYZ(c(ax.direction())),
            xvec: toXYZ(c(ax.xDirection())),
        });
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
            return "forward";
        case wasm.TopAbs_Orientation.TopAbs_REVERSED:
            return "reversed";
        case wasm.TopAbs_Orientation.TopAbs_INTERNAL:
            return "internal";
        case wasm.TopAbs_Orientation.TopAbs_EXTERNAL:
            return "external";
        default:
            return "forward";
    }
}

export function getShapeType(shape: TopoDS_Shape): ShapeType {
    if (shape.isNull()) {
        throw new Error("Shape is null");
    }

    switch (shape.shapeType()) {
        case wasm.TopAbs_ShapeEnum.TopAbs_COMPOUND:
            return ShapeTypes.compound;
        case wasm.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
            return ShapeTypes.compoundSolid;
        case wasm.TopAbs_ShapeEnum.TopAbs_SOLID:
            return ShapeTypes.solid;
        case wasm.TopAbs_ShapeEnum.TopAbs_SHELL:
            return ShapeTypes.shell;
        case wasm.TopAbs_ShapeEnum.TopAbs_FACE:
            return ShapeTypes.face;
        case wasm.TopAbs_ShapeEnum.TopAbs_WIRE:
            return ShapeTypes.wire;
        case wasm.TopAbs_ShapeEnum.TopAbs_EDGE:
            return ShapeTypes.edge;
        case wasm.TopAbs_ShapeEnum.TopAbs_VERTEX:
            return ShapeTypes.vertex;
        default:
            return ShapeTypes.shape;
    }
}

export function getShapeEnum(shapeType: ShapeType): TopAbs_ShapeEnum {
    switch (shapeType) {
        case ShapeTypes.compound:
            return wasm.TopAbs_ShapeEnum.TopAbs_COMPOUND;
        case ShapeTypes.compoundSolid:
            return wasm.TopAbs_ShapeEnum.TopAbs_COMPSOLID;
        case ShapeTypes.solid:
            return wasm.TopAbs_ShapeEnum.TopAbs_SOLID;
        case ShapeTypes.shell:
            return wasm.TopAbs_ShapeEnum.TopAbs_SHELL;
        case ShapeTypes.face:
            return wasm.TopAbs_ShapeEnum.TopAbs_FACE;
        case ShapeTypes.wire:
            return wasm.TopAbs_ShapeEnum.TopAbs_WIRE;
        case ShapeTypes.edge:
            return wasm.TopAbs_ShapeEnum.TopAbs_EDGE;
        case ShapeTypes.vertex:
            return wasm.TopAbs_ShapeEnum.TopAbs_VERTEX;
        case ShapeTypes.shape:
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
        case "arc":
            return wasm.GeomAbs_JoinType.GeomAbs_Arc;
        case "intersection":
            return wasm.GeomAbs_JoinType.GeomAbs_Intersection;
        case "tangent":
            return wasm.GeomAbs_JoinType.GeomAbs_Tangent;
        default:
            throw new Error("Unknown join type: " + joinType);
    }
}

export function getCurveType(curve: any): CurveType {
    const isType = (type: string) => wasm.Transient.isInstance(curve, type);
    if (isType("Geom_Line")) return "line";
    else if (isType("Geom_Circle")) return "circle";
    else if (isType("Geom_Ellipse")) return "ellipse";
    else if (isType("Geom_Hyperbola")) return "hyperbola";
    else if (isType("Geom_Parabola")) return "parabola";
    else if (isType("Geom_BezierCurve")) return "bezierCurve";
    else if (isType("Geom_BSplineCurve")) return "bsplineCurve";
    else if (isType("Geom_OffsetCurve")) return "offsetCurve";
    else if (isType("Geom_TrimmedCurve")) return "trimmedCurve";

    throw new Error("Unknown curve type");
}

export function getSurfaceType(surface: any): SurfaceType {
    const isType = (type: string) => wasm.Transient.isInstance(surface, type);
    if (isType("GeomPlate_Surface")) return "plate";
    else if (isType("Geom_Plane")) return "plane";
    else if (isType("Geom_SurfaceOfLinearExtrusion")) return "extrusion";
    else if (isType("Geom_SurfaceOfRevolution")) return "revolution";
    else if (isType("Geom_OffsetSurface")) return "offset";
    else if (isType("Geom_BSplineSurface")) return "bspline";
    else if (isType("Geom_BezierSurface")) return "bezier";
    else if (isType("Geom_CylindricalSurface")) return "cylinder";
    else if (isType("Geom_ConicalSurface")) return "conical";
    else if (isType("Geom_SphericalSurface")) return "spherical";
    else if (isType("Geom_RectangularTrimmedSurface")) return "rectangularTrimmed";
    else if (isType("Geom_ToroidalSurface")) return "toroidal";
    else if (isType("ShapeExtent_CompositeSurface")) return "composite";

    throw new Error("Unknown surface type");
}

export function convertToContinuity(cni: GeomAbs_Shape) {
    switch (cni) {
        case wasm.GeomAbs_Shape.GeomAbs_C0:
            return "c0";
        case wasm.GeomAbs_Shape.GeomAbs_G1:
            return "g1";
        case wasm.GeomAbs_Shape.GeomAbs_C1:
            return "c1";
        case wasm.GeomAbs_Shape.GeomAbs_G2:
            return "g2";
        case wasm.GeomAbs_Shape.GeomAbs_C2:
            return "c2";
        case wasm.GeomAbs_Shape.GeomAbs_C3:
            return "c3";
        case wasm.GeomAbs_Shape.GeomAbs_CN:
            return "cn";
        default:
            throw new Error("unknown continuity");
    }
}

export function convertFromContinuity(continuity: Continuity) {
    switch (continuity) {
        case "c0":
            return wasm.GeomAbs_Shape.GeomAbs_C0;
        case "g1":
            return wasm.GeomAbs_Shape.GeomAbs_G1;
        case "c1":
            return wasm.GeomAbs_Shape.GeomAbs_C1;
        case "g2":
            return wasm.GeomAbs_Shape.GeomAbs_G2;
        case "c2":
            return wasm.GeomAbs_Shape.GeomAbs_C2;
        case "c3":
            return wasm.GeomAbs_Shape.GeomAbs_C3;
        case "cn":
            return wasm.GeomAbs_Shape.GeomAbs_CN;
        default:
            throw new Error("unknown continuity");
    }
}
