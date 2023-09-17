// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IEdge,
    IFace,
    ILine,
    IShape,
    ISolid,
    IVertex,
    IWire,
    MathUtils,
    Plane,
    Ray,
    Result,
    XYZ,
} from "chili-core";
import { IShapeFactory } from "chili-geo";

import { BRepBuilderAPI_MakeWire } from "opencascade.js";
import { OccHelps } from "./occHelps";
import { OccEdge, OccFace, OccShape, OccSolid, OccVertex, OccWire } from "./occShape";

export class ShapeFactory implements IShapeFactory {
    fuse(bottom: IShape, top: IShape): Result<IShape> {
        throw new Error("Method not implemented.");
    }

    sweep(profile: IShape, path: IWire): Result<IShape> {
        let spine = (path as OccWire).shape;
        let tprofile = (profile as OccShape).shape;
        let builder = new occ.BRepOffsetAPI_MakePipe_1(spine, tprofile);
        if (builder.IsDone()) {
            return Result.success(OccHelps.getShape(builder.Shape()));
        }
        return Result.error("Failed to create a shape from a profile and a path");
    }

    revolve(profile: IShape, axis: Ray, angle: number): Result<IShape> {
        let tprofile = (profile as OccShape).shape;
        let ax1 = new occ.gp_Ax1_2(OccHelps.toPnt(axis.location), OccHelps.toDir(axis.direction));
        let builder = new occ.BRepPrimAPI_MakeRevol_1(tprofile, ax1, MathUtils.degToRad(angle), false);
        if (builder.IsDone()) {
            return Result.success(OccHelps.getShape(builder.Shape()));
        }
        return Result.error("Failed to revolve profile");
    }

    prism(shape: IShape, vec: XYZ): Result<IShape> {
        if (shape instanceof OccShape) {
            let builder = new occ.BRepPrimAPI_MakePrism_1(shape.shape, OccHelps.toVec(vec), false, true);
            if (builder.IsDone()) {
                return Result.success(OccHelps.getShape(builder.Shape()));
            } else {
                return Result.error("Cannot create prism");
            }
        } else {
            return Result.error("Unsupported shape");
        }
    }

    polygon(...points: XYZ[]): Result<IWire, string> {
        let make = new occ.BRepBuilderAPI_MakePolygon_1();
        points.forEach((x) => {
            make.Add_1(OccHelps.toPnt(x));
        });
        if (make.IsDone()) {
            return Result.success(new OccWire(make.Wire()));
        }
        return Result.error("Create polygon error");
    }

    circle(normal: XYZ, center: XYZ, radius: number): Result<IEdge, string> {
        if (MathUtils.almostEqual(radius, 0)) {
            return Result.error("Radius cannot be 0");
        }
        let ax2 = new occ.gp_Ax2_3(OccHelps.toPnt(center), OccHelps.toDir(normal));
        let circ = new occ.gp_Circ_2(ax2, radius);
        let make = new occ.BRepBuilderAPI_MakeEdge_8(circ);
        if (make.IsDone()) {
            return Result.success(new OccEdge(make.Edge()));
        }
        return Result.error("Create circle error");
    }

    rect(plane: Plane, dx: number, dy: number): Result<IFace, string> {
        if (MathUtils.almostEqual(dx, 0) || MathUtils.almostEqual(dy, 0)) {
            return Result.error("Length cannot be 0");
        }
        let pln = OccHelps.toPln(plane);
        let make = new occ.BRepBuilderAPI_MakeFace_9(pln, 0, dx, 0, dy);
        if (make.IsDone()) {
            return Result.success(new OccFace(make.Face()));
        }
        return Result.error("Create rectangle error");
    }

    box(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid, string> {
        if (MathUtils.almostEqual(dx, 0) || MathUtils.almostEqual(dy, 0) || MathUtils.almostEqual(dz, 0)) {
            return Result.error("Length cannot be 0");
        }
        let pln = OccHelps.toPln(plane);
        let faceMake = new occ.BRepBuilderAPI_MakeFace_9(pln, 0, dx, 0, dy);
        if (faceMake.IsDone()) {
            let vec = new occ.gp_Vec_2(OccHelps.toDir(plane.normal));
            vec.Scale(dz);
            let prismMake = new occ.BRepPrimAPI_MakePrism_1(faceMake.Face(), vec, false, false);
            if (prismMake.IsDone()) {
                return Result.success(new OccSolid(prismMake.Shape()));
            }
        }
        return Result.error("Create box error");
    }

    point(point: XYZ): Result<IVertex, string> {
        let build = new occ.BRepBuilderAPI_MakeVertex(OccHelps.toPnt(point));
        if (build.IsDone()) {
            return Result.success(new OccVertex(build.Vertex()));
        }
        return Result.error("error");
    }

    line(start: XYZ, end: XYZ): Result<IEdge> {
        let make = new occ.BRepBuilderAPI_MakeEdge_3(OccHelps.toPnt(start), OccHelps.toPnt(end));
        if (make.IsDone()) {
            return Result.success(new OccEdge(make.Edge()));
        }
        return Result.error("error");
    }

    wire(...edges: IEdge[]): Result<IWire> {
        if (edges.length === 0) return Result.error("empty edges");
        let builder = new occ.BRepBuilderAPI_MakeWire_1();
        if (edges.length === 1) {
            builder.Add_1((edges[0] as OccEdge).shape);
        } else {
            this.addOrderedEdges(builder, edges);
        }
        switch (builder.Error()) {
            case occ.BRepBuilderAPI_WireError.BRepBuilderAPI_DisconnectedWire:
                return Result.error(
                    "The last edge which you attempted to add was not connected to the wire.",
                );
            case occ.BRepBuilderAPI_WireError.BRepBuilderAPI_NonManifoldWire:
                return Result.error("The wire with some singularity");
            case occ.BRepBuilderAPI_WireError.BRepBuilderAPI_EmptyWire:
                return Result.error("The wire is empty");
            default:
                return Result.success(new OccWire(builder.Wire()));
        }
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
}
