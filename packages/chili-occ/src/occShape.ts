// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    ICompound,
    ICompoundSolid,
    IEdge,
    IFace,
    IShape,
    IShapeMeshData,
    IShell,
    ISolid,
    ISurface,
    ITrimmedCurve,
    IVertex,
    IWire,
    Id,
    JoinType,
    Matrix4,
    Orientation,
    Plane,
    Ray,
    Result,
    SerializedProperties,
    Serializer,
    ShapeType,
    SurfaceType,
    XYZ,
} from "chili-core";
import {
    BOPTools_AlgoTools3D,
    BRepTools,
    BRep_Tool,
    TopoDS_Edge,
    TopoDS_Face,
    TopoDS_Shape,
    TopoDS_Vertex,
    TopoDS_Wire,
} from "../occ-wasm/chili_occ";

import { OccShapeConverter } from "./occConverter";
import { OccTrimmedCurve } from "./occCurve";
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
    isEmpty(): boolean {
        return BOPTools_AlgoTools3D.IsEmptyShape(this.shape);
    }

    isClosed(): boolean {
        return BRep_Tool.IsClosed_1(this.shape);
    }

    section(shape: IShape | Plane): IShape {
        if (shape instanceof OccShape) {
            let s = new occ.BRepAlgoAPI_Section_3(this.shape, shape.shape, true);
            return OccHelps.wrapShape(s.Shape());
        } else if (shape instanceof Plane) {
            let pln = OccHelps.toPln(shape);
            let s = new occ.BRepAlgoAPI_Section_5(this.shape, pln, true);
            return OccHelps.wrapShape(s.Shape());
        }

        throw new Error("Invalid section");
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

    findSubShapes(shapeType: ShapeType): IShape[] {
        let result = new Array<IShape>();
        let iter = OccHelps.mapShapes(this.shape, OccHelps.getShapeEnum(shapeType));
        for (const it of iter) {
            result.push(OccHelps.wrapShape(it));
        }

        return result;
    }

    *iterSubShapes(shapeType: ShapeType, unique: boolean = false): IterableIterator<IShape> {
        let iter = OccHelps.iterShapes(this.shape, OccHelps.getShapeEnum(shapeType), unique);
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

    split(edges: (IEdge | IWire)[]): IShape {
        let shapes = new occ.TopTools_SequenceOfShape_1();
        edges.forEach((shape) => {
            shapes.Append_1((shape as unknown as OccShape).shape);
        });

        let spliter = new occ.BRepFeat_SplitShape_2(this.shape);
        spliter.Add_1(shapes);
        let message = new occ.Message_ProgressRange_1();
        spliter.Build(message);
        if (!spliter.IsDone()) {
            throw new Error("Failed to split shape");
        }
        return OccHelps.wrapShape(spliter.Shape());
    }

    splitWithFace(onFace: IFace, edges: IEdge | IWire): IShape {
        let face = onFace as OccFace;
        let spliter = new occ.BRepFeat_SplitShape_2(this.shape);
        if (edges instanceof OccEdge) {
            spliter.Add_3(edges.shape, face.shape);
        } else if (edges instanceof OccWire) {
            spliter.Add_2(edges.shape, face.shape);
        }
        return OccHelps.wrapShape(spliter.Shape());
    }

    splitWithEdge(onEdge: IEdge, edge: IEdge): IShape {
        let spliter = new occ.BRepFeat_SplitShape_2(this.shape);
        spliter.Add_5((onEdge as OccEdge).shape, (edge as OccEdge).shape);
        return OccHelps.wrapShape(spliter.Shape());
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

    curve(): ITrimmedCurve {
        let s: any = { current: 0 };
        let e: any = { current: 0 };
        let curve = occ.BRep_Tool.Curve_2(this.shape, s, e);
        return new OccTrimmedCurve(new occ.Geom_TrimmedCurve(curve, s.current, e.current, true, true));
    }
}

@Serializer.register("Wire", ["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccWire extends OccShape implements IWire {
    constructor(shape: TopoDS_Wire, id?: string) {
        super(shape, id);
    }

    offset(distance: number, joinType: JoinType): Result<IShape> {
        let brepOffset = new occ.BRepOffsetAPI_MakeOffset_3(
            this.shape,
            OccHelps.getJoinType(joinType),
            false,
        );
        try {
            brepOffset.Perform(distance, 0.0);
        } catch (e) {
            console.error(e);

            return Result.err("Offset error");
        }
        return Result.ok(OccHelps.wrapShape(brepOffset.Shape()));
    }

    toFace(): Result<IFace> {
        let make = new occ.BRepBuilderAPI_MakeFace_15(this.shape, true);
        if (make.IsDone()) {
            return Result.ok(new OccFace(make.Face()));
        }
        return Result.err("Wire to face error");
    }
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

    outerWire(): IWire {
        let wire = occ.ShapeAnalysis.OuterWire(this.shape);
        return new OccWire(wire);
    }

    surface(): ISurface {
        let surface = occ.BRep_Tool.Surface_2(this.shape);
        console.log(SurfaceType[OccHelps.getSurfaceType(surface.get())]);

        throw new Error("Not implemented");
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
