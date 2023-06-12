// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

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
    Logger,
    Matrix4,
    Ray,
    Result,
    ShapeMeshData,
    ShapeType,
    XYZ,
} from "chili-core";
import {
    Geom_Circle,
    Geom_Line,
    STEPControl_StepModelType,
    TopoDS_Edge,
    TopoDS_Shape,
    TopoDS_Vertex,
    TopoDS_Wire,
} from "opencascade.js";

import { OccCircle, OccCurve, OccLine } from "./occGeometry";
import { OccHelps } from "./occHelps";
import { OccMesh } from "./occMesh";

export class OccShape implements IShape {
    readonly id: string;
    readonly shapeType: ShapeType;

    private _shape: TopoDS_Shape;
    get shape() {
        return this._shape;
    }

    private _mesh: IShapeMeshData | undefined;
    get mesh(): IShapeMeshData {
        if (this._mesh === undefined) {
            this._mesh = OccMesh.create(this);
        }
        return this._mesh;
    }

    constructor(shape: TopoDS_Shape, id?: string) {
        this.id = id ?? Id.new();
        this._shape = shape;
        this.shapeType = OccHelps.getShapeType(shape);
    }

    resetShape(shape: TopoDS_Shape, generateMesh: boolean) {
        if (this._shape.ShapeType() !== shape.ShapeType()) {
            throw new Error(`ShapeType inconsistency`);
        }
        this._shape = shape;
        if (generateMesh) this._mesh = undefined;
    }

    setMatrix(matrix: Matrix4): void {
        let trsf = OccHelps.convertMatrix(matrix);
        this.shape.Location_2(new occ.TopLoc_Location_2(trsf), true);

        this.resetGroupShapes(ShapeType.Face, this._mesh?.faces);
        this.resetGroupShapes(ShapeType.Edge, this._mesh?.edges);
    }

    private resetGroupShapes(type: ShapeType, data?: ShapeMeshData) {
        if (data) {
            let index = 0;
            let shapes = OccHelps.findSubShapes(this.shape, OccHelps.getShapeEnum(type), true);
            for (const shape of shapes) {
                (data.groups.at(index++)?.shape as OccShape)?.resetShape(shape, false);
            }
        }
    }

    toJson(): string {
        throw new Error("没有实现 toJson");
    }

    blobStep() {
        const filename = "blob.step";
        const writer = new occ.STEPControl_Writer_1();
        occ.Interface_Static.SetIVal("write.step.schema", 5);
        writer.Model(true);
        const progress = new occ.Message_ProgressRange_1();
        writer.Transfer(
            this.shape,
            occ.STEPControl_StepModelType.STEPControl_AsIs as STEPControl_StepModelType,
            true,
            progress
        );

        const done = writer.Write(filename);
        if (done === occ.IFSelect_ReturnStatus.IFSelect_RetDone) {
            const file = occ.FS.readFile("/" + filename);
            occ.FS.unlink("/" + filename);
            return new Blob([file], { type: "application/STEP" });
        } else {
            throw new Error("WRITE STEP FILE FAILED.");
        }
    }

    findSubShapes(shapeType: ShapeType, unique: boolean = false): IShape[] {
        let result = new Array<IShape>();
        let iter = OccHelps.findSubShapes(this.shape, OccHelps.getShapeEnum(shapeType), unique);
        for (const it of iter) {
            result.push(OccHelps.getShape(it));
        }
        return result;
    }

    *iterSubShapes(shapeType: ShapeType, unique: boolean = false): IterableIterator<IShape> {
        let iter = OccHelps.findSubShapes(this.shape, OccHelps.getShapeEnum(shapeType), unique);
        for (const it of iter) {
            yield OccHelps.getShape(it);
        }
    }

    isEqual(other: IShape): boolean {
        if (other instanceof OccShape) return this.shape.IsEqual(other.shape);
        return false;
    }
}

export class OccVertex extends OccShape implements IVertex {
    constructor(shape: TopoDS_Vertex, id?: string) {
        super(shape, id);
    }

    point() {
        let pnt = occ.BRep_Tool.Pnt(this.shape);
        return OccHelps.toXYZ(pnt);
    }
}

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
        let curve = occ.BRep_Tool.Curve_2(this.shape, s, e).get();
        let curveType = OccHelps.getCurveType(curve);
        if (curveType === CurveType.Line) {
            return Result.ok(new OccLine(curve as Geom_Line, s.current, e.current));
        } else if (curveType === CurveType.Circle) {
            return Result.ok(new OccCircle(curve as Geom_Circle, s.current, e.current));
        } else {
            Logger.warn("Unsupported curve type");
            return Result.ok(new OccCurve(curve, s.current, e.current));
        }
    }
}

export class OccWire extends OccShape implements IWire {
    constructor(shape: TopoDS_Wire, id?: string) {
        super(shape, id);
    }

    toFace(): Result<IFace> {
        let make = new occ.BRepBuilderAPI_MakeFace_15(this.shape, true);
        if (make.IsDone()) {
            return Result.ok(new OccFace(make.Face()));
        }
        return Result.error("Wire to face error");
    }
}

export class OccFace extends OccShape implements IFace {}

export class OccShell extends OccShape implements IShell {}

export class OccSolid extends OccShape implements ISolid {}

export class OccCompound extends OccShape implements ICompound {}

export class OccCompoundSolid extends OccShape implements ICompoundSolid {}
