// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Continuity,
    CurveType,
    ICurve,
    IShape,
    ISurface,
    Id,
    JoinType,
    Matrix4,
    Orientation,
    Plane,
    ShapeType,
    SurfaceType,
    XYZ,
    gc,
} from "chili-core";
import {
    GeomAbs_JoinType,
    GeomAbs_Shape,
    Geom_BSplineCurve,
    Geom_BezierCurve,
    Geom_Circle,
    Geom_Curve,
    Geom_Ellipse,
    Geom_Hyperbola,
    Geom_Line,
    Geom_OffsetCurve,
    Geom_Parabola,
    Geom_Surface,
    Geom_TrimmedCurve,
    TopAbs_ShapeEnum,
    TopTools_ListOfShape,
    TopoDS_Shape,
    gp_Ax2,
    gp_Ax3,
    gp_Dir,
    gp_Pln,
    gp_Pnt,
    gp_Trsf,
    gp_Vec,
} from "../occ-wasm/chili_occ";

import {
    OccBSplineCurve,
    OccBezierCurve,
    OccCircle,
    OccEllipse,
    OccHyperbola,
    OccLine,
    OccOffsetCurve,
    OccParabola,
    OccTrimmedCurve,
} from "./occCurve";
import {
    OccCompound,
    OccCompoundSolid,
    OccEdge,
    OccFace,
    OccShape,
    OccShell,
    OccSolid,
    OccVertex,
    OccWire,
} from "./occShape";
import {
    OccBSplineSurface,
    OccBezierSurface,
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
} from "./occSurface";

export class OccHelps {
    static toXYZ(p: gp_Pnt | gp_Dir | gp_Vec): XYZ {
        return new XYZ(p.X(), p.Y(), p.Z());
    }

    static toDir(value: XYZ) {
        return new occ.gp_Dir_4(value.x, value.y, value.z);
    }

    static toPnt(value: XYZ) {
        return new occ.gp_Pnt_3(value.x, value.y, value.z);
    }

    static toVec(value: XYZ) {
        return new occ.gp_Vec_4(value.x, value.y, value.z);
    }

    static fromAx23(ax: gp_Ax2 | gp_Ax3): Plane {
        return gc((c) => {
            return new Plane(
                OccHelps.toXYZ(c(ax.Location())),
                OccHelps.toXYZ(c(ax.Direction())),
                OccHelps.toXYZ(c(ax.XDirection())),
            );
        });
    }

    static toAx2(plane: Plane): gp_Ax2 {
        return gc((c) => {
            return new occ.gp_Ax2_2(
                c(OccHelps.toPnt(plane.origin)),
                c(OccHelps.toDir(plane.normal)),
                c(OccHelps.toDir(plane.xvec)),
            );
        });
    }

    static toAx3(plane: Plane): gp_Ax3 {
        return gc((c) => {
            return new occ.gp_Ax3_3(
                c(OccHelps.toPnt(plane.origin)),
                c(OccHelps.toDir(plane.normal)),
                c(OccHelps.toDir(plane.xvec)),
            );
        });
    }

    static fromPln(pln: gp_Pln): Plane {
        return gc((c) => {
            let ax3 = c(pln.Position());
            return this.fromAx23(ax3);
        });
    }

    static toPln(plane: Plane): gp_Pln {
        return gc((c) => {
            return new occ.gp_Pln_2(c(OccHelps.toAx3(plane)));
        });
    }

    static hashCode(shape: TopoDS_Shape) {
        return shape.HashCode(2147483647); // max int
    }

    static convertFromMatrix(matrix: Matrix4): gp_Trsf {
        const arr = matrix.toArray();
        let trsf = new occ.gp_Trsf_1();
        trsf.SetValues(
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
            matrix.Value(1, 1),
            matrix.Value(2, 1),
            matrix.Value(3, 1),
            0,
            matrix.Value(1, 2),
            matrix.Value(2, 2),
            matrix.Value(3, 2),
            0,
            matrix.Value(1, 3),
            matrix.Value(2, 3),
            matrix.Value(3, 3),
            0,
            matrix.Value(1, 4),
            matrix.Value(2, 4),
            matrix.Value(3, 4),
            1,
        ];
        return Matrix4.fromArray(arr);
    }

    static getCurveType(curve: Geom_Curve): CurveType {
        let isType = (type: string) => curve.IsInstance_2(type);
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

    static getSurfaceType(surface: Geom_Surface): SurfaceType {
        let isType = (type: string) => surface.IsInstance_2(type);
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

    static getShapeType(shape: TopoDS_Shape): ShapeType {
        switch (shape.ShapeType()) {
            case occ.TopAbs_ShapeEnum.TopAbs_COMPOUND:
                return ShapeType.Compound;
            case occ.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
                return ShapeType.CompoundSolid;
            case occ.TopAbs_ShapeEnum.TopAbs_SOLID:
                return ShapeType.Solid;
            case occ.TopAbs_ShapeEnum.TopAbs_SHELL:
                return ShapeType.Shell;
            case occ.TopAbs_ShapeEnum.TopAbs_FACE:
                return ShapeType.Face;
            case occ.TopAbs_ShapeEnum.TopAbs_WIRE:
                return ShapeType.Wire;
            case occ.TopAbs_ShapeEnum.TopAbs_EDGE:
                return ShapeType.Edge;
            case occ.TopAbs_ShapeEnum.TopAbs_VERTEX:
                return ShapeType.Vertex;
            default:
                return ShapeType.Shape;
        }
    }

    static getOrientation(shape: TopoDS_Shape): Orientation {
        switch (shape.Orientation_1()) {
            case occ.TopAbs_Orientation.TopAbs_FORWARD:
                return Orientation.FORWARD;
            case occ.TopAbs_Orientation.TopAbs_REVERSED:
                return Orientation.REVERSED;
            case occ.TopAbs_Orientation.TopAbs_INTERNAL:
                return Orientation.INTERNAL;
            case occ.TopAbs_Orientation.TopAbs_EXTERNAL:
                return Orientation.EXTERNAL;
            default:
                return Orientation.FORWARD;
        }
    }

    static getJoinType(joinType: JoinType) {
        switch (joinType) {
            case JoinType.arc:
                return occ.GeomAbs_JoinType.GeomAbs_Arc as GeomAbs_JoinType;
            case JoinType.intersection:
                return occ.GeomAbs_JoinType.GeomAbs_Intersection as GeomAbs_JoinType;
            case JoinType.tangent:
                return occ.GeomAbs_JoinType.GeomAbs_Tangent as GeomAbs_JoinType;
            default:
                throw new Error("Unknown join type: " + joinType);
        }
    }

    static getShapeEnum(shapeType: ShapeType): TopAbs_ShapeEnum {
        switch (shapeType) {
            case ShapeType.Compound:
                return occ.TopAbs_ShapeEnum.TopAbs_COMPOUND as TopAbs_ShapeEnum;
            case ShapeType.CompoundSolid:
                return occ.TopAbs_ShapeEnum.TopAbs_COMPSOLID as TopAbs_ShapeEnum;
            case ShapeType.Solid:
                return occ.TopAbs_ShapeEnum.TopAbs_SOLID as TopAbs_ShapeEnum;
            case ShapeType.Shell:
                return occ.TopAbs_ShapeEnum.TopAbs_SHELL as TopAbs_ShapeEnum;
            case ShapeType.Face:
                return occ.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum;
            case ShapeType.Wire:
                return occ.TopAbs_ShapeEnum.TopAbs_WIRE as TopAbs_ShapeEnum;
            case ShapeType.Edge:
                return occ.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum;
            case ShapeType.Vertex:
                return occ.TopAbs_ShapeEnum.TopAbs_VERTEX as TopAbs_ShapeEnum;
            case ShapeType.Shape:
                return occ.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum;
            default:
                throw new Error("Unknown shape type: " + shapeType);
        }
    }

    static wrapShape(shape: TopoDS_Shape, id: string = Id.generate()): IShape {
        switch (shape.ShapeType()) {
            case occ.TopAbs_ShapeEnum.TopAbs_COMPOUND:
                return new OccCompound(occ.TopoDS.Compound_1(shape), id);
            case occ.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
                return new OccCompoundSolid(occ.TopoDS.CompSolid_1(shape), id);
            case occ.TopAbs_ShapeEnum.TopAbs_SOLID:
                return new OccSolid(occ.TopoDS.Solid_1(shape), id);
            case occ.TopAbs_ShapeEnum.TopAbs_SHELL:
                return new OccShell(occ.TopoDS.Shell_1(shape), id);
            case occ.TopAbs_ShapeEnum.TopAbs_FACE:
                return new OccFace(occ.TopoDS.Face_1(shape), id);
            case occ.TopAbs_ShapeEnum.TopAbs_WIRE:
                return new OccWire(occ.TopoDS.Wire_1(shape), id);
            case occ.TopAbs_ShapeEnum.TopAbs_EDGE:
                return new OccEdge(occ.TopoDS.Edge_1(shape), id);
            case occ.TopAbs_ShapeEnum.TopAbs_VERTEX:
                return new OccVertex(occ.TopoDS.Vertex_1(shape), id);
            default:
                return new OccShape(shape, id);
        }
    }

    static wrapSurface(surface: Geom_Surface): ISurface {
        let isType = (type: string) => surface.IsInstance_2(type);
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

        throw new Error("Unknown surface type: " + surface.DynamicType().Name);
    }

    static wrapCurve(curve: Geom_Curve): ICurve {
        let isType = (type: string) => curve.IsInstance_2(type);
        if (isType("Geom_Line")) return new OccLine(curve as Geom_Line);
        else if (isType("Geom_Circle")) return new OccCircle(curve as Geom_Circle);
        else if (isType("Geom_Ellipse")) return new OccEllipse(curve as Geom_Ellipse);
        else if (isType("Geom_Hyperbola")) return new OccHyperbola(curve as Geom_Hyperbola);
        else if (isType("Geom_Parabola")) return new OccParabola(curve as Geom_Parabola);
        else if (isType("Geom_BezierCurve")) return new OccBezierCurve(curve as Geom_BezierCurve);
        else if (isType("Geom_BSplineCurve")) return new OccBSplineCurve(curve as Geom_BSplineCurve);
        else if (isType("Geom_OffsetCurve")) return new OccOffsetCurve(curve as Geom_OffsetCurve);
        else if (isType("Geom_TrimmedCurve")) return new OccTrimmedCurve(curve as Geom_TrimmedCurve);

        throw new Error("Unknown curve type: " + curve.DynamicType().Name);
    }

    static getActualShape(shape: TopoDS_Shape): TopoDS_Shape {
        switch (shape.ShapeType()) {
            case occ.TopAbs_ShapeEnum.TopAbs_COMPOUND:
                return occ.TopoDS.Compound_1(shape);
            case occ.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
                return occ.TopoDS.CompSolid_1(shape);
            case occ.TopAbs_ShapeEnum.TopAbs_SOLID:
                return occ.TopoDS.Solid_1(shape);
            case occ.TopAbs_ShapeEnum.TopAbs_SHELL:
                return occ.TopoDS.Shell_1(shape);
            case occ.TopAbs_ShapeEnum.TopAbs_FACE:
                return occ.TopoDS.Face_1(shape);
            case occ.TopAbs_ShapeEnum.TopAbs_WIRE:
                return occ.TopoDS.Wire_1(shape);
            case occ.TopAbs_ShapeEnum.TopAbs_EDGE:
                return occ.TopoDS.Edge_1(shape);
            case occ.TopAbs_ShapeEnum.TopAbs_VERTEX:
                return occ.TopoDS.Vertex_1(shape);
            default:
                return shape;
        }
    }

    static convertContinuity(cni: GeomAbs_Shape) {
        switch (cni) {
            case occ.GeomAbs_Shape.GeomAbs_C0:
                return Continuity.C0;
            case occ.GeomAbs_Shape.GeomAbs_G1:
                return Continuity.G1;
            case occ.GeomAbs_Shape.GeomAbs_C1:
                return Continuity.C1;
            case occ.GeomAbs_Shape.GeomAbs_G2:
                return Continuity.G2;
            case occ.GeomAbs_Shape.GeomAbs_C2:
                return Continuity.C2;
            case occ.GeomAbs_Shape.GeomAbs_C3:
                return Continuity.C3;
            case occ.GeomAbs_Shape.GeomAbs_CN:
                return Continuity.CN;
            default:
                throw new Error("unknown continuity");
        }
    }

    static fromArray(shapes: IShape[]): TopTools_ListOfShape {
        let listOfShape = new occ.TopTools_ListOfShape_1();
        shapes.forEach((shape) => {
            if (!(shape instanceof OccShape)) {
                throw new Error("The OCC kernel only supports OCC geometries.");
            }
            listOfShape.Append_1(shape.shape);
        });
        return listOfShape;
    }

    static toArray(shapes: TopTools_ListOfShape): IShape[] {
        const arr: IShape[] = [];
        while (!shapes.IsEmpty()) {
            let first = shapes.First_1();
            arr.push(this.wrapShape(first));
            shapes.RemoveFirst();
        }
        return arr;
    }

    static *mapShapes(shape: TopoDS_Shape, shapeType: TopAbs_ShapeEnum) {
        let indexShape = new occ.TopTools_IndexedMapOfShape_1();
        occ.TopExp.MapShapes_1(shape, shapeType, indexShape);
        for (let i = 1; i <= indexShape.Extent(); i++) {
            const item = indexShape.FindKey(i);
            yield this.getActualShape(item);
        }

        indexShape.delete();
    }

    static findAncestors(subShape: TopoDS_Shape, from: TopoDS_Shape, ancestorType: TopAbs_ShapeEnum) {
        return gc((c) => {
            let map = c(new occ.TopTools_IndexedDataMapOfShapeListOfShape_1());
            occ.TopExp.MapShapesAndAncestors(from, subShape.ShapeType(), ancestorType, map);
            const index = map.FindIndex(subShape);
            let item = c(map.FindFromIndex(index));
            let shapes: TopoDS_Shape[] = [];
            while (!item.IsEmpty()) {
                shapes.push(this.getActualShape(item.Last_1()));
                item.RemoveFirst();
            }
            return shapes;
        });
    }

    static *iterShapes(
        shape: TopoDS_Shape,
        shapeType: TopAbs_ShapeEnum,
        unique: boolean,
    ): IterableIterator<TopoDS_Shape> {
        const explorer = new occ.TopExp_Explorer_2(
            shape,
            shapeType,
            occ.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
        );
        const hashes = unique ? new Map() : undefined;
        while (explorer.More()) {
            const item = explorer.Current();
            if (unique) {
                const hash = OccHelps.hashCode(item);
                if (!hashes!.has(hash)) {
                    hashes!.set(hash, true);
                    yield this.getActualShape(item);
                }
            } else {
                yield item;
            }
            explorer.Next();
        }

        explorer.delete();
    }
}
