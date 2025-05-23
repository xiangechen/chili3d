// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Continuity,
    CurveType,
    gc,
    ICurve,
    Id,
    IShape,
    ISurface,
    JoinType,
    Matrix4,
    Orientation,
    Plane,
    Ray,
    ShapeType,
    SurfaceType,
    XYZ,
} from "chili-core";
import {
    Geom_BezierCurve,
    Geom_BSplineCurve,
    Geom_Circle,
    Geom_Curve,
    Geom_Ellipse,
    Geom_Hyperbola,
    Geom_Line,
    Geom_OffsetCurve,
    Geom_Parabola,
    Geom_Surface,
    Geom_TrimmedCurve,
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
import {
    OccBezierCurve,
    OccBSplineCurve,
    OccCircle,
    OccEllipse,
    OccHyperbola,
    OccLine,
    OccOffsetCurve,
    OccParabola,
    OccTrimmedCurve,
} from "./curve";
import {
    OccCompound,
    OccCompSolid,
    OccEdge,
    OccFace,
    OccShape,
    OccShell,
    OccSolid,
    OccVertex,
    OccWire,
} from "./shape";
import {
    OccBezierSurface,
    OccBSplineSurface,
    OccCompositeSurface,
    OccConicalSurface,
    OccCylindricalSurface,
    OccOffsetSurface,
    OccPlane,
    OccPlateSurface,
    OccRectangularSurface,
    OccSphericalSurface,
    OccSurfaceOfLinearExtrusion,
    OccSurfaceOfRevolution,
    OccToroidalSurface,
} from "./surface";

export class OcctHelper {
    static toXYZ(p: gp_Pnt | gp_Dir | gp_Vec | Vector3): XYZ {
        return new XYZ(p.x, p.y, p.z);
    }

    static toDir(value: Vector3) {
        return new wasm.gp_Dir(value.x, value.y, value.z);
    }

    static toPnt(value: Vector3) {
        return new wasm.gp_Pnt(value.x, value.y, value.z);
    }

    static toVec(value: Vector3) {
        return new wasm.gp_Vec(value.x, value.y, value.z);
    }

    static toAx1(ray: Ray): gp_Ax1 {
        return gc((c) => {
            return new wasm.gp_Ax1(c(OcctHelper.toPnt(ray.location)), c(OcctHelper.toDir(ray.direction)));
        });
    }

    static toAx2(plane: Plane): gp_Ax2 {
        return gc((c) => {
            return new wasm.gp_Ax2(
                c(OcctHelper.toPnt(plane.origin)),
                c(OcctHelper.toDir(plane.normal)),
                c(OcctHelper.toDir(plane.xvec)),
            );
        });
    }

    static toAx3(plane: Plane): gp_Ax3 {
        return new wasm.gp_Ax3(
            OcctHelper.toPnt(plane.origin),
            OcctHelper.toDir(plane.normal),
            OcctHelper.toDir(plane.xvec),
        );
    }

    static fromAx23(ax: gp_Ax2 | gp_Ax3): Plane {
        return gc((c) => {
            return new Plane(
                OcctHelper.toXYZ(c(ax.location())),
                OcctHelper.toXYZ(c(ax.direction())),
                OcctHelper.toXYZ(c(ax.xDirection())),
            );
        });
    }

    static fromPln(pln: gp_Pln): Plane {
        return gc((c) => {
            let ax3 = c(pln.position());
            return this.fromAx23(ax3);
        });
    }

    static toPln(plane: Plane): gp_Pln {
        return gc((c) => {
            return new wasm.gp_Pln(c(OcctHelper.toAx3(plane)));
        });
    }

    static convertFromMatrix(matrix: Matrix4): gp_Trsf {
        const arr = matrix.toArray();
        let trsf = new wasm.gp_Trsf();
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

    static convertToMatrix(matrix: gp_Trsf): Matrix4 {
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

    static getOrientation(shape: TopoDS_Shape): Orientation {
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

    static getShapeType(shape: TopoDS_Shape): ShapeType {
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

    static getShapeEnum(shapeType: ShapeType): TopAbs_ShapeEnum {
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

    static getActualShape(shape: TopoDS_Shape): TopoDS_Shape {
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

    static getJoinType(joinType: JoinType) {
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

    static wrapShape(shape: TopoDS_Shape, id: string = Id.generate()): IShape {
        if (shape.isNull()) {
            throw new Error("Shape is null");
        }

        switch (shape.shapeType()) {
            case wasm.TopAbs_ShapeEnum.TopAbs_COMPOUND:
                return new OccCompound(wasm.TopoDS.compound(shape), id);
            case wasm.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
                return new OccCompSolid(wasm.TopoDS.compsolid(shape), id);
            case wasm.TopAbs_ShapeEnum.TopAbs_SOLID:
                return new OccSolid(wasm.TopoDS.solid(shape), id);
            case wasm.TopAbs_ShapeEnum.TopAbs_SHELL:
                return new OccShell(wasm.TopoDS.shell(shape), id);
            case wasm.TopAbs_ShapeEnum.TopAbs_FACE:
                return new OccFace(wasm.TopoDS.face(shape), id);
            case wasm.TopAbs_ShapeEnum.TopAbs_WIRE:
                return new OccWire(wasm.TopoDS.wire(shape), id);
            case wasm.TopAbs_ShapeEnum.TopAbs_EDGE:
                return new OccEdge(wasm.TopoDS.edge(shape), id);
            case wasm.TopAbs_ShapeEnum.TopAbs_VERTEX:
                return new OccVertex(wasm.TopoDS.vertex(shape), id);
            default:
                return new OccShape(shape, id);
        }
    }

    static wrapCurve(curve: Geom_Curve): ICurve {
        let isType = (type: string) => wasm.Transient.isInstance(curve, type);
        if (isType("Geom_Line")) return new OccLine(curve as Geom_Line);
        else if (isType("Geom_Circle")) return new OccCircle(curve as Geom_Circle);
        else if (isType("Geom_Ellipse")) return new OccEllipse(curve as Geom_Ellipse);
        else if (isType("Geom_Hyperbola")) return new OccHyperbola(curve as Geom_Hyperbola);
        else if (isType("Geom_Parabola")) return new OccParabola(curve as Geom_Parabola);
        else if (isType("Geom_BezierCurve")) return new OccBezierCurve(curve as Geom_BezierCurve);
        else if (isType("Geom_BSplineCurve")) return new OccBSplineCurve(curve as Geom_BSplineCurve);
        else if (isType("Geom_OffsetCurve")) return new OccOffsetCurve(curve as Geom_OffsetCurve);
        else if (isType("Geom_TrimmedCurve")) return new OccTrimmedCurve(curve as Geom_TrimmedCurve);

        throw new Error("Unknown curve type: " + String(curve));
    }

    static getCurveType(curve: Geom_Curve): CurveType {
        let isType = (type: string) => wasm.Transient.isInstance(curve, type);
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

    static wrapSurface(surface: Geom_Surface): ISurface {
        let isType = (type: string) => wasm.Transient.isInstance(surface, type);
        let actualSurface = surface as any;
        if (isType("GeomPlate_Surface")) return new OccPlateSurface(actualSurface);
        else if (isType("Geom_Plane")) return new OccPlane(actualSurface);
        else if (isType("Geom_SurfaceOfLinearExtrusion"))
            return new OccSurfaceOfLinearExtrusion(actualSurface);
        else if (isType("Geom_SurfaceOfRevolution")) return new OccSurfaceOfRevolution(actualSurface);
        else if (isType("Geom_OffsetSurface")) return new OccOffsetSurface(actualSurface);
        else if (isType("Geom_BSplineSurface")) return new OccBSplineSurface(actualSurface);
        else if (isType("Geom_BezierSurface")) return new OccBezierSurface(actualSurface);
        else if (isType("Geom_CylindricalSurface")) return new OccCylindricalSurface(actualSurface);
        else if (isType("Geom_ConicalSurface")) return new OccConicalSurface(actualSurface);
        else if (isType("Geom_SphericalSurface")) return new OccSphericalSurface(actualSurface);
        else if (isType("Geom_RectangularTrimmedSurface")) return new OccRectangularSurface(actualSurface);
        else if (isType("Geom_ToroidalSurface")) return new OccToroidalSurface(actualSurface);
        else if (isType("ShapeExtent_CompositeSurface")) return new OccCompositeSurface(actualSurface);

        throw new Error("Unknown surface type: " + String(surface));
    }

    static getSurfaceType(surface: Geom_Surface): SurfaceType {
        let isType = (type: string) => wasm.Transient.isInstance(surface, type);
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

    static convertContinuity(cni: GeomAbs_Shape) {
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
}
