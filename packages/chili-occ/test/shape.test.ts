// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import initOpenCascade, { BRepBuilderAPI_MakeVertex, OpenCascadeInstance } from "opencascade.js/dist/node.js";
import { expect, jest, test } from "@jest/globals";
import "reflect-metadata";
import { CurveType } from "chili-geo";
import { Ray, ShapeType, XYZ } from "chili-shared";
import { Id } from "chili-core";
import { OccEdge } from "../src/occShape";
import { OccCurve } from "../src/occGeometry";
import { OccMesh } from "../src/occMesh";
import { OccHelps } from "../src/occHelps";

const newId = jest.spyOn(Id, "new").mockImplementation(() => {
    return "asfas";
});

let occ: OpenCascadeInstance;

beforeAll(async () => {
    console.log(initOpenCascade);

    occ = await initOpenCascade();
    global.occ = occ;
}, 30000);

describe("shape test", () => {
    test("test edge", () => {
        let start1 = new occ.gp_Pnt_3(0, 0, 0);
        let end1 = new occ.gp_Pnt_3(10, 0, 0);
        let make1 = new occ.BRepBuilderAPI_MakeEdge_3(start1, end1);
        expect(make1.IsDone()).toBeTruthy();
        let edge1 = new OccEdge(make1.Edge());
        expect(edge1.shapeType).toBe(ShapeType.Edge);
        let ps = edge1.asCurve().value!.project(new XYZ(5, 0, 0));
        expect(ps.length).toBe(1);
        expect(ps[0].x).toBe(5);

        let start2 = new occ.gp_Pnt_3(5, -5, 0);
        let end2 = new occ.gp_Pnt_3(5, 5, 0);
        let make2 = new occ.BRepBuilderAPI_MakeEdge_3(start2, end2);
        let edge2 = new OccEdge(make2.Edge());
        let intersections = edge2.intersect(edge1);
        expect(intersections.length).toBe(1);
        expect(intersections[0].x).toBe(5);

        let ray = new Ray(XYZ.unitZ.reverse(), XYZ.unitX.add(XYZ.unitZ));
        expect(edge1.intersect(ray)[0].isEqualTo(XYZ.unitX)).toBeTruthy();
    });
});

describe("geometry test", () => {
    test("test edge", () => {
        let start = new occ.gp_Pnt_3(-10, 0, 0);
        let end = new occ.gp_Pnt_3(10, 0, 0);
        let make = new occ.BRepBuilderAPI_MakeEdge_3(start, end);
        expect(make.IsDone()).toBeTruthy();
        let edge = new OccEdge(make.Edge());
        let curve = edge.asCurve().value!;
        expect(curve instanceof OccCurve).toBe(true);
        expect(edge.length()).toBe(20);
        expect(curve.point(curve.firstParameter()).x).toBe(-10);
        expect(curve.point(curve.lastParameter()).x).toBe(10);
        expect(curve.curveType).toBe(CurveType.Line);
        expect(curve.point(0).x).toBe(-10);
        expect(curve.firstParameter()).toBe(0);
        expect(curve.lastParameter()).toBe(20);
    });
});

describe("curve test", () => {
    test("test Geom_Curve", () => {
        let ps = new occ.gp_Pnt_3(0, 0, 0);
        let pe = new occ.gp_Pnt_3(10, 0, 0);
        let e1 = new occ.BRepBuilderAPI_MakeEdge_3(ps, pe).Edge();
        let s: any = { current: 0 };
        let e: any = { current: 0 };
        let c = occ.BRep_Tool.Curve_2(e1, s, e);
        expect(s.current).toBe(0);
        expect(e.current).toBe(10);
        expect(occ.Precision.IsInfinite(c.get().FirstParameter())).toBe(true);
        let tc = new occ.Geom_TrimmedCurve(c, s.current, e.current, true, true);
        expect(tc.FirstParameter()).toBe(0);
        expect(tc.LastParameter()).toBe(10);
        console.log(OccHelps.toXYZ(c.get().Value(c.get().FirstParameter())));

        let lin = new occ.gp_Lin_3(ps, new occ.gp_Dir_4(1, 0, 0));
        e1 = new occ.BRepBuilderAPI_MakeEdge_4(lin).Edge();
        c = occ.BRep_Tool.Curve_2(e1, s, e);
        tc = new occ.Geom_TrimmedCurve(c, s.current, e.current, true, true);
        expect(occ.Precision.IsInfinite(tc.FirstParameter())).toBe(true);

        let ax = new occ.gp_Ax2_2(ps, new occ.gp_Dir_4(0, 0, 1), new occ.gp_Dir_4(1, 0, 0));
        let circ = new occ.gp_Circ_2(ax, 10);
        e1 = new occ.BRepBuilderAPI_MakeEdge_8(circ).Edge();
        c = occ.BRep_Tool.Curve_2(e1, s, e);
        expect(c.get().FirstParameter()).toBe(0);
        expect(c.get().LastParameter() - 6.28 < 0.01).toBeTruthy();
        tc = new occ.Geom_TrimmedCurve(c, s.current, e.current, true, true);
        expect(tc.FirstParameter()).toBe(0);
        expect(tc.LastParameter() - 6.28 < 0.01).toBeTruthy();

        e1 = new occ.BRepBuilderAPI_MakeEdge_9(circ, 1, 2).Edge();
        c = occ.BRep_Tool.Curve_2(e1, s, e);
        expect(c.get().FirstParameter()).toBe(0);
        expect(c.get().LastParameter() - 6.28 < 0.01).toBeTruthy();
        tc = new occ.Geom_TrimmedCurve(c, s.current, e.current, true, true);
        expect(tc.FirstParameter()).toBe(1);
        expect(tc.LastParameter()).toBe(2);
    });
});
