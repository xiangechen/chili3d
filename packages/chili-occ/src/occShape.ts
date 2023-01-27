// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Id,
    ICompound,
    ICompoundSolid,
    ICurve,
    IEdge,
    IFace,
    IShapeMesh,
    IShape,
    IShell,
    ISolid,
    IVertex,
    IWire,
} from "chili-core";
import { Ray, Result, ShapeType, XYZ } from "chili-core";
import {
    Geom_Circle,
    Geom_Line,
    TopoDS_Compound,
    TopoDS_CompSolid,
    TopoDS_Edge,
    TopoDS_Face,
    TopoDS_Shape,
    TopoDS_Shell,
    TopoDS_Solid,
    TopoDS_Vertex,
    TopoDS_Wire,
} from "opencascade.js";
import { OccCircle, OccCurve, OccLine } from "./occGeometry";
import { OccMesh } from "./occMesh";
import { OccHelps } from "./occHelps";

export class OccShapeBase {
    readonly id: string;
    readonly shapeType: ShapeType;

    constructor(readonly shape: TopoDS_Shape) {
        this.id = Id.new();
        this.shapeType = OccHelps.getShapeType(shape);
    }

    mesh(): IShapeMesh {
        return new OccMesh(this.shape);
    }

    toJson(): string {
        throw new Error("没有实现 toJson");
    }
}

export class OccShape extends OccShapeBase implements IShape {
    constructor(shape: TopoDS_Shape) {
        super(shape);
    }
}

export class OccVertex extends OccShapeBase implements IVertex {
    constructor(shape: TopoDS_Vertex) {
        super(shape);
    }

    point() {
        let pnt = occ.BRep_Tool.Pnt(this.shape);
        return OccHelps.toXYZ(pnt);
    }
}

export class OccEdge extends OccShapeBase implements IEdge {
    constructor(shape: TopoDS_Edge) {
        super(shape);
    }

    static fromCurve(curve: OccCurve): OccEdge {
        let trimmed = new occ.Handle_Geom_TrimmedCurve_2(curve.curve);
        let edge = new occ.BRepBuilderAPI_MakeEdge_24(trimmed);
        return new OccEdge(edge.Edge());
    }

    intersect(other: IEdge | Ray): XYZ[] {
        if (other instanceof OccEdge) {
            return this.intersectToEdge(other.shape);
        } else {
            let ray = other as Ray;
            let start = OccHelps.toPnt(ray.location);
            let end = OccHelps.toPnt(ray.location.add(ray.direction.multiply(1e22)));
            let shape = new occ.BRepBuilderAPI_MakeEdge_3(start, end);
            if (shape.IsDone()) {
                return this.intersectToEdge(shape.Edge());
            }
            return [];
        }
    }

    private intersectToEdge(edge: TopoDS_Edge): XYZ[] {
        let result = new Array<XYZ>();
        let cc = new occ.BRepExtrema_ExtCC_2(this.shape, edge);
        if (cc.IsDone() && cc.NbExt() > 0 && !cc.IsParallel()) {
            for (let i = 1; i <= cc.NbExt(); i++) {
                if (cc.SquareDistance(i) <= occ.Precision.Confusion()) {
                    let pnt = cc.PointOnE1(i);
                    result.push(OccHelps.toXYZ(pnt));
                }
            }
        }
        return result;
    }

    length(): number {
        let curve = new occ.BRepAdaptor_Curve_2(this.shape);
        return occ.GCPnts_AbscissaPoint.Length_3(curve, occ.Precision.Confusion());
    }

    asCurve(): Result<ICurve> {
        let s: any = { current: 0 };
        let e: any = { current: 0 };
        let curve = occ.BRep_Tool.Curve_2(this.shape, s, e);
        let isType = (type: string) => curve.get().IsInstance_2(type);
        if (isType("Geom_Line")) {
            return Result.ok(new OccLine(curve.get() as Geom_Line, s.current, e.current));
        } else if (isType("Geom_Circle")) {
            return Result.ok(new OccCircle(curve.get() as Geom_Circle, s.current, e.current));
        }

        return Result.error("Unsupported curve type");
    }
}

export class OccWire extends OccShapeBase implements IWire {
    constructor(shape: TopoDS_Wire) {
        super(shape);
    }

    toFace(): Result<IFace> {
        let make = new occ.BRepBuilderAPI_MakeFace_15(this.shape, true);
        if (make.IsDone()) {
            return Result.ok(new OccFace(make.Face()));
        }
        return Result.error("Wire to face error");
    }
}

export class OccFace extends OccShapeBase implements IFace {
    constructor(shape: TopoDS_Face) {
        super(shape);
    }
}

export class OccShell extends OccShapeBase implements IShell {
    constructor(shape: TopoDS_Shell) {
        super(shape);
    }
}

export class OccSolid extends OccShapeBase implements ISolid {
    constructor(shape: TopoDS_Solid) {
        super(shape);
    }
}

export class OccCompound extends OccShapeBase implements ICompound {
    constructor(shape: TopoDS_Compound) {
        super(shape);
    }
}

export class OccCompoundSolid extends OccShapeBase implements ICompoundSolid {
    constructor(shape: TopoDS_CompSolid) {
        super(shape);
    }
}
