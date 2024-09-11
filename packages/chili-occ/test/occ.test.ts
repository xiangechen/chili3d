// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { expect, test } from "@jest/globals";
import { CurveType, Matrix4, Plane, Ray, ShapeType, XYZ } from "chili-core";
import initOpenCascade, { OpenCascadeInstance } from "opencascade.js/dist/node.js";
import { TopAbs_ShapeEnum, TopoDS_Edge } from "../occ-wasm/chili_occ";
import { OccCurve } from "../src/occCurve";
import { OccHelps } from "../src/occHelps";
import { OccEdge, OccShape, OccSolid } from "../src/occShape";
import { ShapeFactory } from "../src";

let occ: OpenCascadeInstance;

beforeAll(async () => {
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
        let ps = edge1.curve().project(new XYZ(5, 0, 0));
        expect(ps.length).toBe(1);
        expect(ps[0].x).toBe(5);

        let start2 = new occ.gp_Pnt_3(5, -5, 0);
        let end2 = new occ.gp_Pnt_3(5, 5, 0);
        let make2 = new occ.BRepBuilderAPI_MakeEdge_3(start2, end2);
        let edge2 = new OccEdge(make2.Edge());
        let intersections = edge2.intersect(edge1);
        expect(intersections.length).toBe(1);
        expect(intersections[0].point.x).toBe(5);

        let ray = new Ray(XYZ.unitZ.reverse(), XYZ.unitX.add(XYZ.unitZ));
        expect(edge1.intersect(ray)[0].point.isEqualTo(XYZ.unitX)).toBeTruthy();
    });

    test("test findSubShape", () => {
        let start = new occ.gp_Pnt_3(-10, 0, 0);
        let end = new occ.gp_Pnt_3(10, 0, 0);
        let make = new occ.BRepBuilderAPI_MakeEdge_3(start, end);
        let edge = new OccEdge(make.Edge());
        expect(edge.findSubShapes(ShapeType.Edge).length).toBe(1);
        expect(edge.findSubShapes(ShapeType.Vertex).length).toBe(2);
        expect(edge.findSubShapes(ShapeType.Shape).length).toBe(0);

        let make2 = new occ.BRepPrimAPI_MakeBox_2(10, 10, 10);
        let box = new OccSolid(make2.Solid());
        expect(box.findSubShapes(ShapeType.Edge).length).toBe(12);
        expect(box.findSubShapes(ShapeType.Face).length).toBe(6);
        expect(box.findSubShapes(ShapeType.Vertex).length).toBe(8);
        expect(box.findSubShapes(ShapeType.Wire).length).toBe(6);
        expect(box.findSubShapes(ShapeType.Shell).length).toBe(1);
        expect(box.findSubShapes(ShapeType.Shell)[0].shapeType).toBe(ShapeType.Shell);
        expect(box.findSubShapes(ShapeType.Shape).length).toBe(0);

        let v1s: any[] = [];
        let iter = box.iterSubShapes(ShapeType.Vertex);
        for (const i of iter) {
            v1s.push(i);
        }
        expect(v1s.length).toBe(48);

        let v2s: any[] = [];
        let iter2 = box.iterSubShapes(ShapeType.Vertex, true);
        for (const i of iter2) {
            v2s.push(i);
        }
        expect(v2s.length).toBe(8);
    });

    test("test ancestors", () => {
        let make2 = new occ.BRepPrimAPI_MakeBox_2(10, 10, 10);
        let box = new OccSolid(make2.Solid());
        let edge = box.findSubShapes(ShapeType.Edge)[0] as any;
        let wire = OccHelps.findAncestors(edge.shape, box.shape, OccHelps.getShapeEnum(ShapeType.Wire));
        expect(wire.length).toBe(2);
        expect(wire[0].ShapeType()).toBe(OccHelps.getShapeEnum(ShapeType.Wire));
    });
});

describe("geometry test", () => {
    test("test edge", () => {
        let start = new occ.gp_Pnt_3(-10, 0, 0);
        let end = new occ.gp_Pnt_3(10, 0, 0);
        let make = new occ.BRepBuilderAPI_MakeEdge_3(start, end);
        expect(make.IsDone()).toBeTruthy();
        let edge = new OccEdge(make.Edge());
        let curve = edge.curve();
        expect(curve instanceof OccCurve).toBe(true);
        expect(edge.length()).toBe(20);
        expect(curve.value(curve.firstParameter()).x).toBe(-10);
        expect(curve.value(curve.lastParameter()).x).toBe(10);
        expect(curve.curveType).toBe(CurveType.TrimmedCurve);
        expect(curve.value(0).x).toBe(-10);
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

    describe("test transform", () => {
        test("test edge transform", () => {
            let ps = new occ.gp_Pnt_3(0, 0, 0);
            let pe = new occ.gp_Pnt_3(10, 0, 0);
            let e1 = new occ.BRepBuilderAPI_MakeEdge_3(ps, pe).Edge();
            let vertexs1 = OccHelps.iterShapes(
                e1,
                occ.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum,
                true,
            );
            let v11: TopoDS_Edge = vertexs1.next().value;
            let v11HasCode = v11.HashCode(1000);
            expect(v11.ShapeType()).toBe(occ.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum);

            let s: any = { current: 0 };
            let e: any = { current: 0 };
            let c1 = occ.BRep_Tool.Curve_2(e1, s, e);
            let pnt1 = new occ.gp_Pnt_1();
            c1.get().D0(0, pnt1);
            expect(pnt1.X()).toBeCloseTo(0);

            let trsf = e1.Location_1().Transformation();
            trsf.SetTranslation_1(new occ.gp_Vec_4(10, 0, 0));
            e1.Location_2(new occ.TopLoc_Location_2(trsf), true);
            let c2 = occ.BRep_Tool.Curve_2(e1, s, e).get();
            let pnt2 = new occ.gp_Pnt_1();
            c2.D0(0, pnt2);
            expect(pnt2.X()).toBeCloseTo(10);

            let vertexs2 = OccHelps.iterShapes(
                e1,
                occ.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum,
                true,
            );
            let v12: TopoDS_Edge = vertexs2.next().value;
            let v12HasCode = v12.HashCode(1000);
            expect(v12.ShapeType()).toBe(occ.TopAbs_ShapeEnum.TopAbs_EDGE as TopAbs_ShapeEnum);
            expect(v12HasCode).not.toBe(v11HasCode);
            expect(v11.IsEqual(v12)).toBeFalsy();
            expect(v11.IsSame(v12)).toBeFalsy();
            expect(v11.IsPartner(v12)).toBeTruthy();
            expect(v11.Orientation_1() === v12.Orientation_1()).toBeTruthy();
            expect(v11.Location_1().Transformation().TranslationPart().X()).toBe(0);
            expect(v12.Location_1().Transformation().TranslationPart().X()).toBe(10);

            let e2 = new occ.BRepBuilderAPI_MakeEdge_3(ps, pe).Edge();
            let e3 = new OccEdge(e2).mesh.edges?.groups.at(0)?.shape as OccEdge;
            expect(e3.shape.IsEqual(e2));
            trsf = e2.Location_1().Transformation();
            trsf.SetTranslation_1(new occ.gp_Vec_4(10, 0, 0));
            e2.Location_2(new occ.TopLoc_Location_2(trsf), true);
            let c3 = occ.BRep_Tool.Curve_2(e2, s, e);
            c3.get().D0(0, pnt2);
            expect(pnt2.X()).toBeCloseTo(10);
        });

        test("test mesh transform", () => {
            let ps = new occ.gp_Pnt_3(10, 0, 0);
            let pe = new occ.gp_Pnt_3(10, 10, 0);
            let e1 = new occ.BRepBuilderAPI_MakeEdge_3(ps, pe).Edge();
            let shape = new OccEdge(e1);
            shape.matrix = Matrix4.createTranslation(10, 20, 30);
            let edge = shape.mesh.edges?.groups.at(0)?.shape as OccEdge;
            let p2 = shape.curve().value(0);
            expect(p2?.x).toBeCloseTo(20);
            expect(edge.curve().value(0).x).toBeCloseTo(20);
        });
    });

    test("test 5000", () => {
        let start = performance.now();
        let count = 0;
        for (let i = 0; i < 5000; i++) {
            let make2 = new occ.BRepPrimAPI_MakeBox_3(new occ.gp_Pnt_1(), 10, 10, 10);
            let box = new OccSolid(make2.Solid());
            count += box.mesh.faces!.positions.length;
        }
        let end = performance.now();
        console.log(`time: ${end - start}ms, count: ${count}`);
    });
});
