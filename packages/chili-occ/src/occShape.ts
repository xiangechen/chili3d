// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    CurveType,
    ICompound,
    ICompoundSolid,
    ICurve,
    IEdge,
    IFace,
    IShape,
    IShapeMeshData,
    IShell,
    ISolid,
    IVertex,
    IWire,
    Id,
    JoinType,
    Logger,
    Matrix4,
    Orientation,
    Ray,
    Result,
    SerializedProperties,
    Serializer,
    ShapeType,
    XYZ,
} from "chili-core";
import {
    Geom_Circle,
    Geom_Line,
    TopoDS_Edge,
    TopoDS_Face,
    TopoDS_Shape,
    TopoDS_Vertex,
    TopoDS_Wire,
} from "../occ-wasm/chili_occ";

import { OccShapeConverter } from "./occConverter";
import { OccCircle, OccCurve, OccLine } from "./occGeometry";
import { OccHelps } from "./occHelps";
import { OccMesh } from "./occMesh";

@Serializer.register("Shape", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccShape implements IShape {
    readonly shapeType: ShapeType;

    private _id: string;
    get id() {
        return this._id;
    }

    private _shape: TopoDS_Shape;
    get shape() {
        return this._shape;
    }

    private _mesh: IShapeMeshData | undefined;
    get mesh(): IShapeMeshData {
        if (this._mesh === undefined) {
            this._mesh = new OccMesh(this);
        }
        return this._mesh;
    }

    constructor(shape: TopoDS_Shape, id?: string) {
        this._id = id ?? Id.generate();
        this._shape = shape;
        this.shapeType = OccHelps.getShapeType(shape);
    }

    get matrix() {
        return OccHelps.convertToMatrix(this.shape.Location_1().Transformation());
    }

    set matrix(value: Matrix4) {
        let trsf = OccHelps.convertFromMatrix(value);
        this.shape.Location_2(new occ.TopLoc_Location_2(trsf), false);
        this._mesh?.updateMeshShape();
    }

    static serialize(target: OccShape): SerializedProperties<OccShape> {
        return {
            shape: new OccShapeConverter().convertToBrep(target).unwrap(),
            id: target.id,
        };
    }

    static deserialize(shape: string, id: string) {
        let tshape = new OccShapeConverter().convertFromBrep(shape).unwrap() as OccShape;
        tshape._id = id;
        return tshape;
    }

    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        if (!(fromShape instanceof OccShape)) {
            throw new Error(`${fromShape} is not an OccShape`);
        }
        let occType = OccHelps.getShapeEnum(ancestorType);
        return OccHelps.findAncestors(this.shape, fromShape.shape, occType).map((x) =>
            OccHelps.wrapShape(x),
        );
    }

    findSubShapes(shapeType: ShapeType, unique: boolean): IShape[] {
        let result = new Array<IShape>();
        let iter = OccHelps.findSubShapes(this.shape, OccHelps.getShapeEnum(shapeType), unique);
        for (const it of iter) {
            result.push(OccHelps.wrapShape(it));
        }
        return result;
    }

    *iterSubShapes(shapeType: ShapeType, unique: boolean = false): IterableIterator<IShape> {
        let iter = OccHelps.findSubShapes(this.shape, OccHelps.getShapeEnum(shapeType), unique);
        for (const it of iter) {
            yield OccHelps.wrapShape(it);
        }
    }

    orientation(): Orientation {
        return OccHelps.getOrientation(this._shape);
    }

    isPartner(other: IShape): boolean {
        if (other instanceof OccShape) return this.shape.IsPartner(other.shape);
        return false;
    }

    isSame(other: IShape): boolean {
        if (other instanceof OccShape) return this.shape.IsSame(other.shape);
        return false;
    }

    isEqual(other: IShape): boolean {
        if (other instanceof OccShape) return this.shape.IsEqual(other.shape);
        return false;
    }
}

@Serializer.register("Vertex", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccVertex extends OccShape implements IVertex {
    constructor(shape: TopoDS_Vertex, id?: string) {
        super(shape, id);
    }

    point() {
        let pnt = occ.BRep_Tool.Pnt(this.shape);
        return OccHelps.toXYZ(pnt);
    }
}

@Serializer.register("Edge", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccEdge extends OccShape implements IEdge {
    constructor(shape: TopoDS_Edge, id?: string) {
        super(shape, id);
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
        }
        if (other instanceof OccEdge) {
            return this.intersectToEdge(other.shape);
        }
        console.warn("不支持的类型");
        return [];
    }

    private intersectToEdge(edge: TopoDS_Edge): XYZ[] {
        let cc = new occ.BRepExtrema_ExtCC_2(this.shape, edge);
        if (!cc.IsDone() || cc.NbExt() === 0 || cc.IsParallel()) {
            return [];
        }

        let result = new Array<XYZ>();
        for (let i = 1; i <= cc.NbExt(); i++) {
            if (cc.SquareDistance(i) <= occ.Precision.Confusion()) {
                let pnt = cc.PointOnE1(i);
                result.push(OccHelps.toXYZ(pnt));
            }
        }
        return result;
    }

    length(): number {
        let curve = new occ.BRepAdaptor_Curve_2(this.shape);
        return occ.GCPnts_AbscissaPoint.Length_3(curve, occ.Precision.Confusion());
    }

    offset(distance: number, dir: XYZ): Result<IEdge> {
        let s: any = { current: 0 };
        let e: any = { current: 0 };
        let curve = occ.BRep_Tool.Curve_2(this.shape, s, e);
        let trimmedCurve = new occ.Handle_Geom_Curve_2(
            new occ.Geom_TrimmedCurve(curve, s.current, e.current, true, true),
        );
        let brepOffset = new occ.Geom_OffsetCurve(trimmedCurve, distance, OccHelps.toDir(dir), true);
        let offsetCurve = new occ.Handle_Geom_Curve_2(brepOffset);
        let edge = new occ.BRepBuilderAPI_MakeEdge_24(offsetCurve);
        return Result.ok(new OccEdge(edge.Edge()));
    }

    asCurve(): Result<ICurve> {
        let s: any = { current: 0 };
        let e: any = { current: 0 };
        let curve = occ.BRep_Tool.Curve_2(this.shape, s, e).get();
        let curveType = OccHelps.getCurveType(curve);
        if (curveType === CurveType.Line) {
            return Result.ok(new OccLine(curve as Geom_Line, s.current, e.current));
        }
        if (curveType === CurveType.Circle) {
            return Result.ok(new OccCircle(curve as Geom_Circle, s.current, e.current));
        }
        if (curveType === CurveType.OffsetCurve) {
            return Result.ok(new OccCurve(curve, s.current, e.current));
        }
        Logger.warn(`Unsupported curve type: ${curveType}`);
        return Result.ok(new OccCurve(curve, s.current, e.current));
    }
}

@Serializer.register("Wire", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccWire extends OccShape implements IWire {
    constructor(shape: TopoDS_Wire, id?: string) {
        super(shape, id);
    }

    toFace(): Result<IFace> {
        let make = new occ.BRepBuilderAPI_MakeFace_15(this.shape, true);
        if (make.IsDone()) {
            return Result.ok(new OccFace(make.Face()));
        }
        return Result.err("Wire to face error");
    }

    offset(distance: number, joinType: JoinType): Result<IShape> {
        return makeOffset(this.shape, joinType, distance);
    }
}

function makeOffset(shape: TopoDS_Face | TopoDS_Wire, joinType: JoinType, distance: number): Result<IShape> {
    let ctor =
        shape.ShapeType() === occ.TopAbs_ShapeEnum.TopAbs_FACE
            ? occ.BRepOffsetAPI_MakeOffset_2
            : occ.BRepOffsetAPI_MakeOffset_3;
    let brepOffset = new ctor(shape, OccHelps.getJoinType(joinType), false);
    brepOffset.Perform(distance, 0.0);
    return Result.ok(OccHelps.wrapShape(brepOffset.Shape()));
}

@Serializer.register("Face", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccFace extends OccShape implements IFace {
    constructor(shape: TopoDS_Face, id?: string) {
        super(shape, id);
    }

    normal(u: number, v: number): [point: XYZ, normal: XYZ] {
        let pnt = new occ.gp_Pnt_1();
        let dir = new occ.gp_Vec_1();
        let a = new occ.BRepGProp_Face_2(this.shape, false);
        a.Normal(u, v, pnt, dir);
        return [OccHelps.toXYZ(pnt), OccHelps.toXYZ(dir).normalize()!];
    }

    offset(distance: number, joinType: JoinType): Result<IShape> {
        return makeOffset(this.shape, joinType, distance);
    }

    outerWire(): IWire {
        let wire = occ.ShapeAnalysis.OuterWire(this.shape);
        return new OccWire(wire);
    }
}

@Serializer.register("Shell", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccShell extends OccShape implements IShell {}

@Serializer.register("Solid", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccSolid extends OccShape implements ISolid {}

@Serializer.register("Compound", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccCompound extends OccShape implements ICompound {
    static fromShapes(...shapes: IShape[]): Result<ICompound> {
        let compound = new occ.TopoDS_Compound();
        let builder = new occ.BRep_Builder();
        builder.MakeCompound(compound);
        for (let shape of shapes) {
            if (shape instanceof OccShape) {
                builder.Add(compound, shape.shape);
            }
        }
        return Result.ok(new OccCompound(compound));
    }
}

@Serializer.register("CompoundSolid", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccCompoundSolid extends OccShape implements ICompoundSolid {}
