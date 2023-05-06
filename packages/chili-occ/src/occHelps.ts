// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CurveType, IShape, Plane, ShapeType, XYZ } from "chili-core";
import {
    BRepAdaptor_Curve,
    Geom_Curve,
    GeomAbs_CurveType,
    GeomAdaptor_Curve,
    gp_Ax2,
    gp_Ax3,
    gp_Dir,
    gp_Pln,
    gp_Pnt,
    gp_Vec,
    Handle_Geom_Curve,
    TopAbs_ShapeEnum,
    TopoDS_Shape,
} from "opencascade.js";

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

    static toAx2(plane: Plane): gp_Ax2 {
        return new occ.gp_Ax2_2(
            OccHelps.toPnt(plane.location),
            OccHelps.toDir(plane.normal),
            OccHelps.toDir(plane.x)
        );
    }

    static toAx3(plane: Plane): gp_Ax3 {
        return new occ.gp_Ax3_3(
            OccHelps.toPnt(plane.location),
            OccHelps.toDir(plane.normal),
            OccHelps.toDir(plane.x)
        );
    }

    static toPln(plane: Plane): gp_Pln {
        return new occ.gp_Pln_2(OccHelps.toAx3(plane));
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
        else return CurveType.OtherCurve;
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
            default:
                return occ.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum;
        }
    }

    static getShape(shape: TopoDS_Shape): IShape {
        switch (shape.ShapeType()) {
            case occ.TopAbs_ShapeEnum.TopAbs_COMPOUND:
                return new OccCompound(occ.TopoDS.Compound_1(shape));
            case occ.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
                return new OccCompoundSolid(occ.TopoDS.CompSolid_1(shape));
            case occ.TopAbs_ShapeEnum.TopAbs_SOLID:
                return new OccSolid(occ.TopoDS.Solid_1(shape));
            case occ.TopAbs_ShapeEnum.TopAbs_SHELL:
                return new OccShell(occ.TopoDS.Shell_1(shape));
            case occ.TopAbs_ShapeEnum.TopAbs_FACE:
                return new OccFace(occ.TopoDS.Face_1(shape));
            case occ.TopAbs_ShapeEnum.TopAbs_WIRE:
                return new OccWire(occ.TopoDS.Wire_1(shape));
            case occ.TopAbs_ShapeEnum.TopAbs_EDGE:
                return new OccEdge(occ.TopoDS.Edge_1(shape));
            case occ.TopAbs_ShapeEnum.TopAbs_VERTEX:
                return new OccVertex(occ.TopoDS.Vertex_1(shape));
            default:
                return new OccShape(shape);
        }
    }
}
