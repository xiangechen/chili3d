// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, type IVertex, Matrix4, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../../src/features/edgeRef";
import { captureVertexRef } from "../../src/features/vertexRef";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { captureVertexAnchors } from "../../src/plane/planeDefinition";
import { PlaneNode } from "../../src/plane/planeNode";
import { type SketchData, SketchNode } from "../../src/sketch";
import { captureFaceRef } from "../../src/sketch/planeRef";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

let previousFactory: PropertyDescriptor | undefined;

beforeAll(async () => {
    previousFactory = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

afterAll(() => {
    if (previousFactory !== undefined) {
        Object.defineProperty(globalThis, "shapeFactory", previousFactory);
    } else {
        delete (globalThis as { shapeFactory?: unknown }).shapeFactory;
    }
});

function square(size: number): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [0, 0, size, 0] },
            { id: 2, type: "line", params: [size, 0, size, size] },
            { id: 3, type: "line", params: [size, size, 0, size] },
            { id: 4, type: "line", params: [0, size, 0, 0] },
        ],
        constraints: [],
    };
}

function rectangle(width: number, height: number): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [0, 0, width, 0] },
            { id: 2, type: "line", params: [width, 0, width, height] },
            { id: 3, type: "line", params: [width, height, 0, height] },
            { id: 4, type: "line", params: [0, height, 0, 0] },
        ],
        constraints: [],
    };
}

function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square(10) });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 10 }],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { doc, body };
}

function facesOf(body: ParametricBodyNode): IFace[] {
    return body.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
}

function edgesOf(body: ParametricBodyNode): IEdge[] {
    return body.shape.value.findSubShapes(ShapeTypes.edge) as IEdge[];
}

function faceWithNormal(body: ParametricBodyNode, axis: XYZ): IFace {
    const face = facesOf(body).find((candidate) => {
        const [, normal] = candidate.normal(0, 0);
        return normal.dot(axis) > 0.9;
    });
    expect(face).toBeDefined();
    return face!;
}

function xEdge(body: ParametricBodyNode): IEdge {
    const edge = edgesOf(body).find((candidate) => {
        const start = candidate.startPoint();
        const end = candidate.endPoint();
        return (
            Math.abs(start.z - end.z) < 1e-6 &&
            Math.abs(start.y - end.y) < 1e-6 &&
            Math.abs(start.x - end.x) > 1
        );
    });
    expect(edge).toBeDefined();
    return edge!;
}

function planeNode(doc: TestDocument, definition: ConstructorParameters<typeof PlaneNode>[0]["definition"]) {
    const node = new PlaneNode({ document: doc, definition });
    doc.modelManager.addNode(node);
    return node;
}

describe("PlaneNode against real geometry", () => {
    test("offset from a body face", () => {
        const { doc, body } = setup();
        const top = faceWithNormal(body, XYZ.unitZ);
        const ref = captureFaceRef(body.id, top);
        const node = planeNode(doc, { kind: "offset", source: { kind: "face", ref }, distance: 5 });

        const plane = node.worldPlane();
        expect(plane).toBeDefined();
        expect(plane!.normal.z).toBeCloseTo(1, 5);
        expect(plane!.origin.z).toBeCloseTo(15, 5);
    });

    test("a point and a parallel plane", () => {
        const { doc, body } = setup();
        const vertex = (body.shape.value.findSubShapes(ShapeTypes.vertex) as IVertex[]).find((candidate) =>
            candidate.point().isEqualTo(new XYZ(10, 0, 0)),
        );
        expect(vertex).toBeDefined();
        const node = planeNode(doc, {
            kind: "planePoint",
            source: { kind: "datum", name: "XY" },
            point: { nodeId: body.id, vertex: captureVertexRef(vertex!) },
        });

        const plane = node.worldPlane();
        expect(plane!.normal.z).toBeCloseTo(1, 5);
        expect(plane!.origin.isEqualTo(new XYZ(10, 0, 0))).toBe(true);
    });

    test("a point reference follows the source node's transform", () => {
        const { doc, body } = setup();
        const vertex = (body.shape.value.findSubShapes(ShapeTypes.vertex) as IVertex[]).find((candidate) =>
            candidate.point().isEqualTo(new XYZ(10, 0, 0)),
        );
        expect(vertex).toBeDefined();
        const node = planeNode(doc, {
            kind: "planePoint",
            source: { kind: "datum", name: "XY" },
            point: { nodeId: body.id, vertex: captureVertexRef(vertex!) },
        });
        expect(node.worldPlane()!.origin.isEqualTo(new XYZ(10, 0, 0))).toBe(true);

        body.transform = Matrix4.fromTranslation(0, 0, 5);
        expect(node.worldPlane()!.origin.isEqualTo(new XYZ(10, 0, 5))).toBe(true);
    });

    test("an edge reference follows the source node's transform", () => {
        const { doc, body } = setup();
        const edge = xEdge(body);
        const start = edge.startPoint();
        const node = planeNode(doc, {
            kind: "lineAngle",
            line: { nodeId: body.id, edge: captureEdgeRef(edge) },
            reference: { kind: "datum", name: "XY" },
            angle: 45,
        });
        expect(node.worldPlane()!.origin.isEqualTo(start)).toBe(true);

        body.transform = Matrix4.fromTranslation(0, 0, 5);
        expect(node.worldPlane()!.origin.isEqualTo(start.add(new XYZ(0, 0, 5)))).toBe(true);
    });

    test("a point reference follows an upstream edit that moves the vertex", () => {
        const { doc, body } = setup();
        const vertex = (body.shape.value.findSubShapes(ShapeTypes.vertex) as IVertex[]).find((candidate) =>
            candidate.point().isEqualTo(new XYZ(10, 0, 10)),
        );
        expect(vertex).toBeDefined();
        const incident = captureVertexAnchors(body.shape.value, vertex!, (index) => body.edgeIdAt(index));
        expect(incident).toBeDefined();
        const node = planeNode(doc, {
            kind: "planePoint",
            source: { kind: "datum", name: "XY" },
            point: {
                nodeId: body.id,
                vertex: captureVertexRef(vertex!),
                incident,
            },
        });
        expect(node.worldPlane()!.origin.isEqualTo(new XYZ(10, 0, 10))).toBe(true);

        // The top face (and this vertex) rises by 10 mm.
        body.setFeatureParameter("f1", "depth", 20);
        expect(body.shape.isOk).toBe(true);
        expect(node.worldPlane()!.origin.isEqualTo(new XYZ(10, 0, 20))).toBe(true);
    });

    test("three vertices", () => {
        const { doc, body } = setup();
        const point = (x: number, y: number) => ({
            nodeId: body.id,
            vertex: { point: { x, y, z: 0 } },
        });
        const node = planeNode(doc, {
            kind: "threePoint",
            points: [point(0, 0), point(10, 0), point(0, 10)],
        });

        const plane = node.worldPlane();
        expect(plane!.normal.z).toBeCloseTo(1, 5);
        expect(plane!.origin.isEqualTo(new XYZ(0, 0, 0))).toBe(true);
    });

    test("a point and a line axis", () => {
        const { doc, body } = setup();
        const edge = xEdge(body);
        const node = planeNode(doc, {
            kind: "pointNormal",
            axis: { nodeId: body.id, edge: captureEdgeRef(edge) },
            point: { nodeId: body.id, vertex: { point: { x: 0, y: 0, z: 0 } } },
        });

        const plane = node.worldPlane();
        expect(Math.abs(plane!.normal.x)).toBeCloseTo(1, 5);
        expect(plane!.origin.isEqualTo(new XYZ(0, 0, 0))).toBe(true);
    });

    test("a line rotated against a reference plane", () => {
        const { doc, body } = setup();
        const edge = xEdge(body);
        const node = planeNode(doc, {
            kind: "lineAngle",
            line: { nodeId: body.id, edge: captureEdgeRef(edge) },
            reference: { kind: "datum", name: "XY" },
            angle: 45,
        });

        const plane = node.worldPlane();
        expect(Math.abs(plane!.normal.y)).toBeCloseTo(Math.SQRT1_2, 5);
        expect(Math.abs(plane!.normal.z)).toBeCloseTo(Math.SQRT1_2, 5);
        expect(Math.abs(plane!.normal.x)).toBeLessThan(1e-5);
    });

    test("the mid plane of two parallel body faces", () => {
        const { doc, body } = setup();
        const top = faceWithNormal(body, XYZ.unitZ);
        const bottom = faceWithNormal(body, XYZ.unitZ.reverse());
        const node = planeNode(doc, {
            kind: "midPlane",
            first: { kind: "face", ref: captureFaceRef(body.id, top) },
            second: { kind: "face", ref: captureFaceRef(body.id, bottom) },
        });

        const plane = node.worldPlane();
        expect(plane!.origin.z).toBeCloseTo(5, 5);
        expect(Math.abs(plane!.normal.z)).toBeCloseTo(1, 5);
    });

    test("a curve-point origin is projected onto the curve", () => {
        const { doc, body } = setup();
        const edge = xEdge(body);
        const start = edge.startPoint();
        // A real vertex on the opposite side of the box: off this edge, so the plane must
        // still be built through the curve's nearest point, not through the vertex.
        const point = { x: start.x, y: start.y === 0 ? 10 : 0, z: start.z };
        const node = planeNode(doc, {
            kind: "curvePoint",
            curve: { nodeId: body.id, edge: captureEdgeRef(edge) },
            point: { nodeId: body.id, vertex: { point } },
        });

        const plane = node.worldPlane();
        expect(plane!.origin.isEqualTo(start)).toBe(true);
        expect(Math.abs(plane!.normal.x)).toBeCloseTo(1, 5);
    });

    test("a point and a curve tangent", () => {
        const { doc, body } = setup();
        const edge = xEdge(body);
        const point = { x: 0, y: 0, z: 0 };
        const node = planeNode(doc, {
            kind: "curvePoint",
            curve: { nodeId: body.id, edge: captureEdgeRef(edge) },
            point: { nodeId: body.id, vertex: { point } },
        });

        const plane = node.worldPlane();
        expect(Math.abs(plane!.normal.x)).toBeCloseTo(1, 5);
        // The origin is the curve point nearest the picked vertex, not the vertex itself.
        const projected = edge.startPoint().x === 0 ? edge.startPoint() : edge.endPoint();
        expect(plane!.origin.isEqualTo(projected)).toBe(true);
    });

    test("a sketch drawn on the plane follows its definition edit", () => {
        const { doc } = setup();
        const node = planeNode(doc, {
            kind: "offset",
            source: { kind: "datum", name: "XY" },
            distance: 20,
        });
        const sketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin: new XYZ(0, 0, 20), normal: XYZ.unitZ, xvec: XYZ.unitX }),
            planeNodeId: node.id,
            data: square(10),
        });
        doc.modelManager.addNode(sketch);
        expect(sketch.shape.isOk).toBe(true);
        expect(sketch.plane.origin.z).toBeCloseTo(20, 5);

        node.distance = 40;
        expect(sketch.plane.origin.z).toBeCloseTo(40, 5);
    });

    test("a missing datum plane reference is a warning, not silence", () => {
        const { doc } = setup();
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            planeNodeId: "missing",
            data: square(10),
        });
        doc.modelManager.addNode(sketch);

        expect(sketch.shape.isOk).toBe(true);
        expect(sketch.warningCount).toBe(1);
        expect(sketch.warningTooltip).toBe("sketch.planeLost{0}");
    });

    test("deleting the datum plane badges the sketch and keeps its last plane", () => {
        const { doc } = setup();
        const plane = planeNode(doc, {
            kind: "offset",
            source: { kind: "datum", name: "XY" },
            distance: 20,
        });
        const sketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin: new XYZ(0, 0, 20), normal: XYZ.unitZ, xvec: XYZ.unitX }),
            planeNodeId: plane.id,
            data: square(10),
        });
        doc.modelManager.addNode(sketch);
        expect(sketch.shape.isOk).toBe(true);
        expect(sketch.warningCount).toBe(0);

        plane.parent?.remove(plane);

        expect(sketch.warningCount).toBe(1);
        // The sketch keeps working on its last known plane.
        expect(sketch.plane.origin.z).toBeCloseTo(20, 5);
    });

    test("the display rectangle grows to cover a sketch drawn on the plane", async () => {
        const { doc } = setup();
        const node = planeNode(doc, {
            kind: "offset",
            source: { kind: "datum", name: "XY" },
            distance: 50,
        });
        const sketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin: new XYZ(0, 0, 50), normal: XYZ.unitZ, xvec: XYZ.unitX }),
            planeNodeId: node.id,
            data: square(200),
        });
        doc.modelManager.addNode(sketch);
        expect(sketch.shape.isOk).toBe(true);

        // The first build defers the fit by one microtask; let it run.
        await Promise.resolve();
        const box = node.shape.value.boundingBox();
        expect(box.max.x - box.min.x).toBeGreaterThan(200);
        expect(box.max.y - box.min.y).toBeGreaterThan(200);
    });

    test("the pickable quad keeps the display rectangle's aspect ratio", async () => {
        const { doc } = setup();
        const node = planeNode(doc, {
            kind: "offset",
            source: { kind: "datum", name: "XY" },
            distance: 50,
        });
        const sketch = new SketchNode({
            document: doc,
            plane: new Plane({ origin: new XYZ(0, 0, 50), normal: XYZ.unitZ, xvec: XYZ.unitX }),
            planeNodeId: node.id,
            data: rectangle(200, 100),
        });
        doc.modelManager.addNode(sketch);
        expect(sketch.shape.isOk).toBe(true);

        await Promise.resolve();
        const quad = node.displayQuad();
        expect(quad).toBeDefined();
        // The kernel's bounding box carries a small tolerance; what matters is that the
        // pickable quad keeps the rectangle's 2:1 aspect ratio, not a square.
        expect(quad!.width).toBeGreaterThan(205);
        expect(quad!.height).toBeGreaterThan(100);
        expect(quad!.width / quad!.height).toBeCloseTo(2, 1);
    });
});
