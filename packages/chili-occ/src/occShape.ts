// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    CurveType,
    ICompound,
    ICompoundSolid,
    ICurve,
    Id,
    IEdge,
    IFace,
    IShape,
    IShapeMesh,
    IShell,
    ISolid,
    IVertex,
    IWire,
    Logger,
    Quaternion,
    Ray,
    Result,
    ShapeType,
    Matrix4,
    XYZ,
} from "chili-core";
import {
    Geom_Circle,
    Geom_Line,
    TopAbs_ShapeEnum,
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
import { OccHelps } from "./occHelps";
import { OccMesh } from "./occMesh";

export class OccShape implements IShape {
    readonly id: string;
    readonly shapeType: ShapeType;

    constructor(readonly shape: TopoDS_Shape) {
        this.id = Id.new();
        this.shapeType = OccHelps.getShapeType(shape);
    }

    setTranslation(offset: XYZ): void {
        const trsf = this.shape.Location_1().Transformation();
        trsf.SetTranslation_1(OccHelps.toVec(offset));
        this.shape.Location_2(new occ.TopLoc_Location_2(trsf), true);
    }

    setRotation(rotation: Quaternion): void {
        const quaternion = new occ.gp_Quaternion_2(rotation.x, rotation.y, rotation.z, rotation.w);
        const trsf = this.shape.Location_1().Transformation();
        trsf.SetRotation_2(quaternion);
        this.shape.Location_2(new occ.TopLoc_Location_2(trsf), true);
    }

    setScale(scale: XYZ, value: number): void {
        const trsf = this.shape.Location_1().Transformation();
        trsf.SetScale(OccHelps.toPnt(scale), value);
        this.shape.Location_2(new occ.TopLoc_Location_2(trsf), true);
    }

    mesh(): IShapeMesh {
        return new OccMesh(this.shape);
    }

    toJson(): string {
        throw new Error("没有实现 toJson");
    }

    findSubShapes(shapeType: ShapeType): IShape[] {
        let result = new Array<IShape>();
        let ex = new occ.TopExp_Explorer_2(
            this.shape,
            OccHelps.getShapeEnum(shapeType),
            occ.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum
        );
        while (ex.More()) {
            let topShape = ex.Current();
            if (!topShape.IsEqual(this.shape)) result.push(OccHelps.getShape(topShape));
            ex.Next();
        }
        return result;
    }

    isEqual(other: IShape): boolean {
        if (other instanceof OccShape) return this.shape.IsEqual(other.shape);
        return false;
    }
}

export class OccVertex extends OccShape implements IVertex {
    constructor(shape: TopoDS_Vertex) {
        super(shape);
    }

    point() {
        let pnt = occ.BRep_Tool.Pnt(this.shape);
        return OccHelps.toXYZ(pnt);
    }
}

export class OccEdge extends OccShape implements IEdge {
    constructor(shape: TopoDS_Edge) {
        super(shape);
    }

    static fromCurve(curve: OccCurve): OccEdge {
        let trimmed = new occ.Handle_Geom_TrimmedCurve_2(curve.curve);
        let edge = new occ.BRepBuilderAPI_MakeEdge_24(trimmed);
        return new OccEdge(edge.Edge());
    }

    intersect(other: IEdge | Ray): XYZ[] {
        if (other instanceof Ray) {
            let start = OccHelps.toPnt(other.location);
            let end = OccHelps.toPnt(other.location.add(other.direction.multiply(1e22)));
            let shape = new occ.BRepBuilderAPI_MakeEdge_3(start, end);
            return this.intersectToEdge(shape.Edge());
        } else {
            if (other instanceof OccEdge) {
                return this.intersectToEdge(other.shape);
            } else {
                console.warn("不支持的类型");
                return [];
            }
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
        let curveType = OccHelps.getCurveType(curve.get());
        if (curveType === CurveType.Line) {
            return Result.ok(new OccLine(curve.get() as Geom_Line, s.current, e.current));
        } else if (curveType === CurveType.Circle) {
            return Result.ok(new OccCircle(curve.get() as Geom_Circle, s.current, e.current));
        } else {
            Logger.warn("Unsupported curve type");
            return Result.ok(new OccCurve(curve.get(), s.current, e.current));
        }
    }
}

export class OccWire extends OccShape implements IWire {
    private readonly _edges: IEdge[];

    constructor(shape: TopoDS_Wire) {
        super(shape);
        this._edges = this.findSubShapes(ShapeType.Edge) as IEdge[];
    }

    get edges(): readonly IEdge[] {
        return [...this._edges];
    }

    toFace(): Result<IFace> {
        let make = new occ.BRepBuilderAPI_MakeFace_15(this.shape, true);
        if (make.IsDone()) {
            return Result.ok(new OccFace(make.Face()));
        }
        return Result.error("Wire to face error");
    }
}

export class OccFace extends OccShape implements IFace {
    private readonly _wires: IWire[];

    constructor(shape: TopoDS_Face) {
        super(shape);
        this._wires = this.findSubShapes(ShapeType.Wire) as IWire[];
    }

    get wires(): readonly IWire[] {
        return [...this._wires];
    }
}

export class OccShell extends OccShape implements IShell {
    private readonly _faces: IFace[] = [];

    constructor(shape: TopoDS_Shell) {
        super(shape);
        this._faces.push(...(this.findSubShapes(ShapeType.Face) as IFace[]));
    }

    get faces(): readonly IFace[] {
        return [...this._faces];
    }
}

export class OccSolid extends OccShape implements ISolid {
    private readonly _shells: IShell[];

    constructor(shape: TopoDS_Solid) {
        super(shape);
        this._shells = this.findSubShapes(ShapeType.Shell) as IShell[];
    }

    get shells(): readonly IShell[] {
        return [...this._shells];
    }
}

export class OccCompound extends OccShape implements ICompound {
    private readonly _shapes: IShape[];

    constructor(shape: TopoDS_Compound) {
        super(shape);
        this._shapes = this.findSubShapes(ShapeType.Shape) as IShape[];
    }

    get shapes(): readonly IShape[] {
        return [...this._shapes];
    }
}

export class OccCompoundSolid extends OccShape implements ICompoundSolid {
    private readonly _solids: ISolid[];

    constructor(shape: TopoDS_CompSolid) {
        super(shape);
        this._solids = this.findSubShapes(ShapeType.Solid) as ISolid[];
    }

    get solids(): readonly ISolid[] {
        return [...this._solids];
    }
}
