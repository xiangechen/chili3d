// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CurveType, IShape } from "chili-geo";
import { ShapeType, XYZ } from "chili-shared";
import { BRepAdaptor_Curve, gp_Dir, gp_Pnt, gp_Vec, TopoDS_Shape } from "opencascade.js";
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

    static getCurveType(adaptorCurve: BRepAdaptor_Curve): CurveType {
        switch (adaptorCurve.GetType()) {
            case occ.GeomAbs_CurveType.GeomAbs_Line:
                return CurveType.Line;
            case occ.GeomAbs_CurveType.GeomAbs_Circle:
                return CurveType.Circle;
            case occ.GeomAbs_CurveType.GeomAbs_Ellipse:
                return CurveType.Ellipse;
            case occ.GeomAbs_CurveType.GeomAbs_Hyperbola:
                return CurveType.Hyperbola;
            case occ.GeomAbs_CurveType.GeomAbs_Parabola:
                return CurveType.Parabola;
            case occ.GeomAbs_CurveType.GeomAbs_BezierCurve:
                return CurveType.BezierCurve;
            case occ.GeomAbs_CurveType.GeomAbs_BSplineCurve:
                return CurveType.BSplineCurve;
            case occ.GeomAbs_CurveType.GeomAbs_OffsetCurve:
                return CurveType.OffsetCurve;
            default:
                return CurveType.OtherCurve;
        }
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

    static getShape(shape: TopoDS_Shape): IShape {
        switch (shape.ShapeType) {
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
