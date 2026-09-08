// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { Matrix4, XYZ } from "@chili3d/core";
import type { Geom_Plane } from "../lib/chili-wasm";
import { convertFromMatrix, fromPln } from "../src/helper";
import { testAx3 } from "./helpers";
import "./setup";

test("should build a wire from two lines sharing a rotated endpoint", () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 10, y: 0, z: 0 };
    const line1 = wasm.TopoDS.edge(wasm.ShapeFactory.line(start, end).shape);

    // line2 is line1 rotated 90° around its own endpoint (Z axis through `end`),
    // so both edges share the endpoint exactly and connect even with a tight tolerance.
    const trsf = convertFromMatrix(Matrix4.fromAxisRad(end, XYZ.unitZ, Math.PI / 3));
    const line2 = wasm.TopoDS.edge(line1.located(new wasm.TopLoc_Location(trsf), false));

    const result = wasm.ShapeFactory.wire([line1, line2]);
    expect(result.isOk).toBe(true);

    const wire = result.shape;
    expect(wire.isNull()).toBe(false);
    expect(wire.shapeType()).toBe(wasm.TopAbs_ShapeEnum.TopAbs_WIRE);
    expect(wasm.Shape.findSubShapes(wire, wasm.TopAbs_ShapeEnum.TopAbs_EDGE).length).toBe(2);
    // the two edges share exactly one vertex, so the wire has 3 unique vertices
    expect(wasm.Shape.findSubShapes(wire, wasm.TopAbs_ShapeEnum.TopAbs_VERTEX).length).toBe(3);
});

test("should mesh a box face with expected buffer sizes", () => {
    const box = wasm.ShapeFactory.box(testAx3, 1, 2, 3).shape;
    const mesher = new wasm.Mesher(box, 0.1, true);
    const mesh = mesher.mesh();

    expect(mesh.faceMeshData.position.length).toBe(72);
    expect(mesh.faceMeshData.index.length).toBe(36);
    expect(mesh.faceMeshData.group.length).toBe(12);
    expect(mesh.faceMeshData.normal.length).toBe(72);
    expect(mesh.faceMeshData.uv.length).toBe(48);
});

test("should mesh box edges", () => {
    const box = wasm.ShapeFactory.box(testAx3, 1, 1, 1).shape;
    const mesher = new wasm.Mesher(box, 0.1, true);
    const mesh = mesher.mesh();
    expect(mesh.edgeMeshData.position.length).toBe(72);
    expect(mesh.edgeMeshData.group.length).toBe(24);
});

test("should traverse sub-shapes and ancestors of a box", () => {
    const box = wasm.ShapeFactory.box(testAx3, 1, 1, 1).shape;
    const edges = wasm.Shape.findSubShapes(box, wasm.TopAbs_ShapeEnum.TopAbs_EDGE);
    expect(edges.length).toBe(12);
    expect(edges[0].shapeType()).toBe(wasm.TopAbs_ShapeEnum.TopAbs_EDGE);

    const curve = wasm.Edge.curve(wasm.TopoDS.edge(edges[0]));
    const newEdge = wasm.Edge.fromCurve(curve.get());
    expect(wasm.Edge.curveLength(newEdge)).toBe(1);

    const faces = wasm.Shape.findAncestor(box, edges[1], wasm.TopAbs_ShapeEnum.TopAbs_FACE);
    expect(faces.length).toBe(2);
    expect(faces[0].shapeType()).toBe(wasm.TopAbs_ShapeEnum.TopAbs_FACE);

    const faceEdges = wasm.Shape.findSubShapes(faces[0], wasm.TopAbs_ShapeEnum.TopAbs_EDGE);
    expect(faceEdges.length).toBe(4);
});

test("should simplify shape and reduce face count", () => {
    const brepPath = path.resolve(import.meta.dirname, "models", "simplifySolid.brep");
    const brepContent = readFileSync(brepPath, "utf-8");
    const shape = wasm.Converter.convertFromBrep(brepContent);
    expect(shape.isNull()).toBe(false);

    const faces1 = wasm.Shape.findSubShapes(shape, wasm.TopAbs_ShapeEnum.TopAbs_FACE);
    expect(faces1.length).toBe(7);
    const result1 = wasm.ShapeFactory.fixSmallFace(shape, 1e-5);
    expect(result1.isOk).toBe(true);

    const result2 = wasm.ShapeFactory.simplifyShape(result1.shape, true, true, [], 1e-5, 1e-5);
    const faces2 = wasm.Shape.findSubShapes(result2.shape, wasm.TopAbs_ShapeEnum.TopAbs_FACE);
    expect(faces2.length).toBe(5);
});

test("should check point containment in a solid", () => {
    const box = wasm.TopoDS.solid(wasm.ShapeFactory.box(testAx3, 1, 1, 1).shape);
    expect(wasm.Solid.containsPoint(box, { x: 0.5, y: 0.5, z: 0.5 }, true, 0.1)).toBe(true);
    expect(wasm.Solid.containsPoint(box, { x: 1, y: 1, z: 1 }, true, 0.1)).toBe(true);
    expect(wasm.Solid.containsPoint(box, { x: 1, y: 1, z: 1 }, false, 0.1)).toBe(false);
    expect(wasm.Solid.containsPoint(box, { x: 1.5, y: 1.5, z: 1.5 }, false, 0.1)).toBe(false);
});

test("should fuse a box with its mirror copy across a box face", () => {
    const box = wasm.ShapeFactory.box(testAx3, 1, 1, 1).shape;

    // find the planar face at x = 1 to use as the mirror plane
    const faces = wasm.Shape.findSubShapes(box, wasm.TopAbs_ShapeEnum.TopAbs_FACE);
    const mirrorPln = faces
        .map((f) => wasm.Face.surface(wasm.TopoDS.face(f)).get())
        .filter((s) => s !== null && wasm.Transient.isInstance(s, "Geom_Plane"))
        .map((s) => (s as Geom_Plane).pln())
        .find((pln) => {
            const ax = pln.position();
            return Math.abs(ax.location().x - 1) < 1e-7 && Math.abs(Math.abs(ax.direction().x) - 1) < 1e-7;
        });
    expect(mirrorPln).not.toBeUndefined();

    const plane = fromPln(mirrorPln!);
    const mirrorMatrix = Matrix4.createMirrorWithPlane(plane);

    // copy the box through the mirror matrix: the copy spans x in [1, 2]
    // (BRepBuilderAPI_Transform rebuilds the geometry — a mirror cannot be a TopLoc location)
    const trsf = convertFromMatrix(mirrorMatrix);
    const mirrored = wasm.Shape.transformed(box, trsf);

    // NOTE: fuse before any Solid.volume call — BRepGProp on the mirrored solid
    // corrupts the subsequent boolean operation (observed empirically).
    const fuse = wasm.ShapeFactory.booleanFuse([box], [mirrored]);
    expect(fuse.isOk).toBe(true);
    const fused = fuse.shape;
    expect(fused.isNull()).toBe(false);

    expect(wasm.Shape.volume(wasm.TopoDS.solid(mirrored))).toBeCloseTo(1, 6);

    // two unit boxes sharing one face fuse into a single solid of volume 2 spanning x in [0, 2]
    const solids = wasm.Shape.findSubShapes(fused, wasm.TopAbs_ShapeEnum.TopAbs_SOLID);
    expect(solids.length).toBe(1);
    expect(wasm.Shape.volume(wasm.TopoDS.solid(solids[0]))).toBeCloseTo(2, 6);
    expect(wasm.Solid.containsPoint(fused, { x: 1.5, y: 0.5, z: 0.5 }, false, 1e-7)).toBe(true);
    expect(wasm.Solid.containsPoint(fused, { x: 2.5, y: 0.5, z: 0.5 }, false, 1e-7)).toBe(false);
});

test("initWasm can be called repeatedly and the module stays functional", async () => {
    const { initWasm } = await import("../src/wasm");
    const wasmBinary = readFileSync(path.resolve(import.meta.dirname, "..", "lib", "chili-wasm.wasm"));
    const first = await initWasm({ wasmBinary });
    const second = await initWasm({ wasmBinary });
    expect(first).toBeDefined();
    expect(global.wasm).toBe(second);

    // The re-initialized module is fully functional
    const box = wasm.ShapeFactory.box(testAx3, 1, 1, 1).shape;
    expect(box.isNull()).toBe(false);
});
