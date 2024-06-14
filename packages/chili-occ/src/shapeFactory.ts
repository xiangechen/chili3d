// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    ICompound,
    IEdge,
    IFace,
    IShape,
    IShapeConverter,
    IShapeFactory,
    ISolid,
    IVertex,
    IWire,
    MathUtils,
    Plane,
    Ray,
    Result,
    XYZ,
} from "chili-core";

import {
    BRepAlgoAPI_BooleanOperation,
    BRepBuilderAPI_MakeWire,
    BRepOffset_Mode,
    GeomAbs_JoinType,
    Geom_BezierCurve,
    Message_ProgressRange,
    TopoDS_Shape,
} from "../occ-wasm/chili_occ";
import { OccShapeConverter } from "./occConverter";
import { OccHelps } from "./occHelps";
import { OccCompound, OccEdge, OccFace, OccShape, OccSolid, OccVertex, OccWire } from "./occShape";

export class ShapeFactory implements IShapeFactory {
    readonly converter: IShapeConverter = new OccShapeConverter();

    fuse(bottom: IShape, top: IShape): Result<IShape> {
        throw new Error("Method not implemented.");
    }

    sweep(profile: IShape, path: IWire): Result<IShape> {
        let spine = (path as OccWire).shape;
        let tprofile = (profile as OccShape).shape;
        let builder = new occ.BRepOffsetAPI_MakePipe_1(spine, tprofile);
        if (builder.IsDone()) {
            return Result.ok(OccHelps.wrapShape(builder.Shape()));
        }
        return Result.err("Failed to create a shape from a profile and a path");
    }

    revolve(profile: IShape, axis: Ray, angle: number): Result<IShape> {
        let tprofile = (profile as OccShape).shape;
        let ax1 = new occ.gp_Ax1_2(OccHelps.toPnt(axis.location), OccHelps.toDir(axis.direction));
        let builder = new occ.BRepPrimAPI_MakeRevol_1(tprofile, ax1, MathUtils.degToRad(angle), false);
        if (builder.IsDone()) {
            return Result.ok(OccHelps.wrapShape(builder.Shape()));
        }
        return Result.err("Failed to revolve profile");
    }

    prism(shape: IShape, vec: XYZ): Result<IShape> {
        if (!(shape instanceof OccShape)) {
            return Result.err("Unsupported shape");
        }
        let builder = new occ.BRepPrimAPI_MakePrism_1(shape.shape, OccHelps.toVec(vec), false, true);
        if (builder.IsDone()) {
            return Result.ok(OccHelps.wrapShape(builder.Shape()));
        }
        return Result.err("Cannot create prism");
    }

    polygon(...points: XYZ[]): Result<IWire, string> {
        let make = new occ.BRepBuilderAPI_MakePolygon_1();
        points.forEach((x) => {
            make.Add_1(OccHelps.toPnt(x));
        });
        if (make.IsDone()) {
            return Result.ok(new OccWire(make.Wire()));
        }
        return Result.err("Create polygon error");
    }

    arc(normal: XYZ, center: XYZ, start: XYZ, angle: number): Result<IEdge> {
        let radius = center.distanceTo(start);
        let xvec = start.sub(center);
        let ax2 = new occ.gp_Ax2_2(OccHelps.toPnt(center), OccHelps.toDir(normal), OccHelps.toDir(xvec));
        let circle = new occ.gp_Circ_2(ax2, radius);
        let radians = (angle * Math.PI) / 180;
        let [startAngle, endAngle] = [0, radians];
        if (angle < 0) [startAngle, endAngle] = [Math.PI * 2 + radians, Math.PI * 2];
        let builder = new occ.BRepBuilderAPI_MakeEdge_9(circle, startAngle, endAngle);
        if (builder.IsDone()) {
            return Result.ok(new OccEdge(builder.Edge()));
        }
        return Result.err("Create arc error");
    }

    bezier(points: XYZ[], weights?: number[]): Result<IEdge> {
        let tolPoints = new occ.TColgp_Array1OfPnt_2(1, points.length);
        points.forEach((x, i) => {
            tolPoints.SetValue(i + 1, OccHelps.toPnt(x));
        });
        let bezier: Geom_BezierCurve;
        if (weights) {
            let tolWeights = new occ.TColStd_Array1OfReal_2(1, weights.length);
            weights.forEach((x, i) => {
                tolWeights.SetValue(i + 1, x);
            });
            bezier = new occ.Geom_BezierCurve_2(tolPoints, tolPoints);
        } else {
            bezier = new occ.Geom_BezierCurve_1(tolPoints);
        }
        let edge = new occ.BRepBuilderAPI_MakeEdge_24(new occ.Handle_Geom_Curve_2(bezier));
        return Result.ok(new OccEdge(edge.Edge()));
    }

    circle(normal: XYZ, center: XYZ, radius: number): Result<IEdge, string> {
        if (MathUtils.almostEqual(radius, 0)) {
            return Result.err("Radius cannot be 0");
        }
        let ax2 = new occ.gp_Ax2_3(OccHelps.toPnt(center), OccHelps.toDir(normal));
        let circ = new occ.gp_Circ_2(ax2, radius);
        let make = new occ.BRepBuilderAPI_MakeEdge_8(circ);
        if (make.IsDone()) {
            return Result.ok(new OccEdge(make.Edge()));
        }
        return Result.err("Create circle error");
    }

    rect(plane: Plane, dx: number, dy: number): Result<IFace, string> {
        if (MathUtils.almostEqual(dx, 0) || MathUtils.almostEqual(dy, 0)) {
            return Result.err("Length cannot be 0");
        }
        let pln = OccHelps.toPln(plane);
        let make = new occ.BRepBuilderAPI_MakeFace_9(pln, 0, dx, 0, dy);
        if (make.IsDone()) {
            return Result.ok(new OccFace(make.Face()));
        }
        return Result.err("Create rectangle error");
    }

    box(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid, string> {
        if (MathUtils.almostEqual(dx, 0) || MathUtils.almostEqual(dy, 0) || MathUtils.almostEqual(dz, 0)) {
            return Result.err("Length cannot be 0");
        }
        let pln = OccHelps.toPln(plane);
        let faceMake = new occ.BRepBuilderAPI_MakeFace_9(pln, 0, dx, 0, dy);
        if (faceMake.IsDone()) {
            let vec = new occ.gp_Vec_2(OccHelps.toDir(plane.normal));
            vec.Scale(dz);
            let prismMake = new occ.BRepPrimAPI_MakePrism_1(faceMake.Face(), vec, false, false);
            if (prismMake.IsDone()) {
                return Result.ok(new OccSolid(prismMake.Shape()));
            }
        }
        return Result.err("Create box error");
    }

    point(point: XYZ): Result<IVertex, string> {
        let build = new occ.BRepBuilderAPI_MakeVertex(OccHelps.toPnt(point));
        if (build.IsDone()) {
            return Result.ok(new OccVertex(build.Vertex()));
        }
        return Result.err("error");
    }

    line(start: XYZ, end: XYZ): Result<IEdge> {
        let make = new occ.BRepBuilderAPI_MakeEdge_3(OccHelps.toPnt(start), OccHelps.toPnt(end));
        if (make.IsDone()) {
            return Result.ok(new OccEdge(make.Edge()));
        }
        return Result.err("error");
    }

    wire(...edges: IEdge[]): Result<IWire> {
        if (edges.length === 0) return Result.err("empty edges");
        if (edges[0] instanceof OccWire) return Result.ok(edges[0]);
        let builder = new occ.BRepBuilderAPI_MakeWire_1();
        if (edges.length === 1) {
            builder.Add_1((edges[0] as OccEdge).shape);
        } else {
            this.addOrderedEdges(builder, edges);
        }
        switch (builder.Error()) {
            case occ.BRepBuilderAPI_WireError.BRepBuilderAPI_DisconnectedWire:
                return Result.err("The last edge which you attempted to add was not connected to the wire.");
            case occ.BRepBuilderAPI_WireError.BRepBuilderAPI_NonManifoldWire:
                return Result.err("The wire with some singularity");
            case occ.BRepBuilderAPI_WireError.BRepBuilderAPI_EmptyWire:
                return Result.err("The wire is empty");
            default:
                return Result.ok(new OccWire(builder.Wire()));
        }
    }

    face(...wire: IWire[]): Result<IFace> {
        let builder = new occ.BRepBuilderAPI_MakeFace_15((wire[0] as OccWire).shape, true);
        for (let i = 1; i < wire.length; i++) {
            if (wire[i] instanceof OccWire) {
                builder.Add((wire[i] as OccWire).shape);
            }
        }
        return Result.ok(new OccFace(builder.Face()));
    }

    private addOrderedEdges(builder: BRepBuilderAPI_MakeWire, edges: IEdge[]) {
        let wireOrder = new occ.ShapeAnalysis_WireOrder_1();
        let edgeAnalyser = new occ.ShapeAnalysis_Edge();
        for (let edge of edges) {
            if (edge instanceof OccEdge) {
                let start = occ.BRep_Tool.Pnt(edgeAnalyser.FirstVertex(edge.shape));
                let end = occ.BRep_Tool.Pnt(edgeAnalyser.LastVertex(edge.shape));
                wireOrder.Add_1(start.XYZ(), end.XYZ());
            } else {
                throw new Error("The OCC kernel only supports OCC geometries.");
            }
        }
        wireOrder.Perform(true);
        if (wireOrder.IsDone()) {
            for (let i = 1; i <= wireOrder.NbEdges(); i++) {
                let index = wireOrder.Ordered(i);
                let edge = (edges[Math.abs(index) - 1] as OccEdge).shape;
                builder.Add_1(index > 0 ? edge : OccHelps.getActualShape(edge.Reversed()));
            }
        }
    }

    makeThickSolidBySimple(shape: IShape, thickness: number): Result<IShape> {
        if (!(shape instanceof OccShape)) {
            throw new Error("The OCC kernel only supports OCC geometries.");
        }

        let builder = new occ.BRepOffsetAPI_MakeThickSolid();
        builder.MakeThickSolidBySimple(shape.shape, thickness);
        if (builder.IsDone()) {
            return Result.ok(OccHelps.wrapShape(builder.Shape()));
        }
        return Result.err("error");
    }

    makeThickSolidByJoin(shape: IShape, closingFaces: IShape[], thickness: number): Result<IShape> {
        if (!(shape instanceof OccShape)) {
            throw new Error("The OCC kernel only supports OCC geometries.");
        }

        let listOfShape = OccHelps.fromArray(closingFaces);
        let builder = new occ.BRepOffsetAPI_MakeThickSolid();
        let messageRange = new occ.Message_ProgressRange_1();
        builder.MakeThickSolidByJoin(
            shape.shape,
            listOfShape,
            thickness,
            0.00001,
            occ.BRepOffset_Mode.BRepOffset_Skin as BRepOffset_Mode,
            false,
            false,
            occ.GeomAbs_JoinType.GeomAbs_Intersection as GeomAbs_JoinType,
            false,
            messageRange,
        );
        if (builder.IsDone()) {
            return Result.ok(OccHelps.wrapShape(builder.Shape()));
        }
        return Result.err("error");
    }

    booleanCommon(shape1: IShape, shape2: IShape): Result<IShape> {
        return this.booleanOperate(shape1, shape2, occ.BRepAlgoAPI_Common_3);
    }

    booleanCut(shape1: IShape, shape2: IShape): Result<IShape> {
        return this.booleanOperate(shape1, shape2, occ.BRepAlgoAPI_Cut_3);
    }

    booleanFuse(shape1: IShape, shape2: IShape): Result<IShape> {
        return this.booleanOperate(shape1, shape2, occ.BRepAlgoAPI_Fuse_3);
    }

    combine(...shapes: IShape[]): Result<ICompound> {
        return OccCompound.fromShapes(...shapes);
    }

    private booleanOperate(
        shape1: IShape,
        shape2: IShape,
        ctor: new (
            shape1: TopoDS_Shape,
            shape2: TopoDS_Shape,
            progress: Message_ProgressRange,
        ) => BRepAlgoAPI_BooleanOperation,
    ) {
        let shapes = ShapeFactory.ensureOccShape(shape1, shape2);
        const progress = new occ.Message_ProgressRange_1();
        let operate = new ctor(shapes[0], shapes[1], progress);
        if (operate.IsDone()) {
            return Result.ok(OccHelps.wrapShape(operate.Shape()));
        }
        return Result.err("Failed to perform boolean operation.");
    }

    static ensureOccShape(...shapes: IShape[]): TopoDS_Shape[] {
        return shapes.map((x) => {
            if (!(x instanceof OccShape)) {
                throw new Error("The OCC kernel only supports OCC geometries.");
            }
            return x.shape;
        });
    }
}
