// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import "./setup";

test("test face mesh", () => {
    const location = { x: 0, y: 0, z: 0 };
    const direction = { x: 0, y: 0, z: 1 };
    const xDirection = { x: 1, y: 0, z: 0 };
    const ax3 = { location, direction, xDirection };
    const box = wasm.ShapeFactory.box(ax3, 1, 2, 3).shape;
    const mesher = new wasm.Mesher(box, 0.1, true);
    const mesh = mesher.mesh();

    expect(mesh.faceMeshData.position.length).toBe(72);
    expect(mesh.faceMeshData.index.length).toBe(36);
    expect(mesh.faceMeshData.group.length).toBe(12);
    expect(mesh.faceMeshData.normal.length).toBe(72);
    expect(mesh.faceMeshData.uv.length).toBe(48);
});

test("test edge mesh", () => {
    const location = { x: 0, y: 0, z: 0 };
    const direction = { x: 0, y: 0, z: 1 };
    const xDirection = { x: 1, y: 0, z: 0 };
    const ax3 = { location, direction, xDirection };
    const box = wasm.ShapeFactory.box(ax3, 1, 1, 1).shape;
    const mesher = new wasm.Mesher(box, 0.1, true);
    const mesh = mesher.mesh();
    expect(mesh.edgeMeshData.position.length).toBe(72);
    expect(mesh.edgeMeshData.group.length).toBe(24);
});

test("test shape", () => {
    const location = { x: 0, y: 0, z: 0 };
    const direction = { x: 0, y: 0, z: 1 };
    const xDirection = { x: 1, y: 0, z: 0 };
    const ax3 = { location, direction, xDirection };
    const box = wasm.ShapeFactory.box(ax3, 1, 1, 1).shape;
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

test("test simplifyShape", () => {
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

test("test solid", () => {
    const location = { x: 0, y: 0, z: 0 };
    const direction = { x: 0, y: 0, z: 1 };
    const xDirection = { x: 1, y: 0, z: 0 };
    const ax3 = { location, direction, xDirection };
    const box = wasm.TopoDS.solid(wasm.ShapeFactory.box(ax3, 1, 1, 1).shape);
    expect(wasm.Solid.containsPoint(box, { x: 0.5, y: 0.5, z: 0.5 }, true, 0.1)).toBe(true);
    expect(wasm.Solid.containsPoint(box, { x: 1, y: 1, z: 1 }, true, 0.1)).toBe(true);
    expect(wasm.Solid.containsPoint(box, { x: 1, y: 1, z: 1 }, false, 0.1)).toBe(false);
    expect(wasm.Solid.containsPoint(box, { x: 1.5, y: 1.5, z: 1.5 }, false, 0.1)).toBe(false);
});
