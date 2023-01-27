// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEdge, IFace, ISolid, IVertex, IWire, MathUtils, Plane, Result, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";

import { OccHelps } from "./occHelps";
import { OccEdge, OccFace, OccSolid, OccVertex, OccWire } from "./occShape";

@Token.set(Token.ShapeFactory)
export class ShapeFactory implements IShapeFactory {
    polygon(...points: XYZ[]): Result<IWire, string> {
        let make = new occ.BRepBuilderAPI_MakePolygon();
        points.forEach((x) => {
            make.Add_1(OccHelps.toPnt(x));
        });
        if (make.IsDone()) {
            return Result.ok(new OccWire(make.Wire()));
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
            return Result.ok(new OccEdge(make.Edge()));
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
            return Result.ok(new OccFace(make.Face()));
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
                return Result.ok(new OccSolid(prismMake.Shape()));
            }
        }
        return Result.error("Create box error");
    }

    point(point: XYZ): Result<IVertex, string> {
        let build = new occ.BRepBuilderAPI_MakeVertex(OccHelps.toPnt(point));
        if (build.IsDone()) {
            return Result.ok(new OccVertex(build.Vertex()));
        }
        return Result.error("error");
    }

    line(start: XYZ, end: XYZ): Result<IEdge> {
        let make = new occ.BRepBuilderAPI_MakeEdge_3(OccHelps.toPnt(start), OccHelps.toPnt(end));
        if (make.IsDone()) {
            return Result.ok(new OccEdge(make.Edge()));
        }
        return Result.error("error");
    }
}
