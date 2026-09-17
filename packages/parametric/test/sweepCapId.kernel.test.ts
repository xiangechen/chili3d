// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";
import "./sketch/setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

// A 40x40 rect with a circular hole (r=8). The hole's swept side face competes with
// the top in any history-less-face heuristic; the mirrored variant keeps every entity
// id on the same geometry but reverses its winding, re-enumerating the wires — stable
// ids must keep indexing the same geometry across the rebuild.
const holedRect = (mirrored: boolean): SketchData => {
    const lines: SketchData["entities"] = mirrored
        ? [
              { id: 1, type: "line", params: [20, -20, -20, -20] },
              { id: 2, type: "line", params: [20, 20, 20, -20] },
              { id: 3, type: "line", params: [-20, 20, 20, 20] },
              { id: 4, type: "line", params: [-20, -20, -20, 20] },
          ]
        : [
              { id: 1, type: "line", params: [-20, -20, 20, -20] },
              { id: 2, type: "line", params: [20, -20, 20, 20] },
              { id: 3, type: "line", params: [20, 20, -20, 20] },
              { id: 4, type: "line", params: [-20, 20, -20, -20] },
          ];
    return { entities: [...lines, { id: 5, type: "circle", params: [0, 0, 8] }], constraints: [] };
};

// The revolve profile lives in the XZ plane (u → x, v → z) and revolves around Z.
const XZ_PLANE = new Plane({
    origin: XYZ.zero,
    normal: new XYZ({ x: 0, y: -1, z: 0 }),
    xvec: XYZ.unitX,
});

// The revolve profile: a rect in the XZ plane (u → x, v → z), x ∈ [10,20],
// z ∈ [0,30]. The mirrored variant keeps every entity id on the same segment with
// swapped endpoints (reversed winding), re-enumerating the wire on rebuild.
const rect = (mirrored: boolean): SketchData => ({
    entities: mirrored
        ? [
              { id: 1, type: "line", params: [20, 0, 10, 0] },
              { id: 2, type: "line", params: [20, 30, 20, 0] },
              { id: 3, type: "line", params: [10, 30, 20, 30] },
              { id: 4, type: "line", params: [10, 0, 10, 30] },
          ]
        : [
              { id: 1, type: "line", params: [10, 0, 20, 0] },
              { id: 2, type: "line", params: [20, 0, 20, 30] },
              { id: 3, type: "line", params: [20, 30, 10, 30] },
              { id: 4, type: "line", params: [10, 30, 10, 0] },
          ],
    constraints: [],
});

function extrudeBody(doc: TestDocument, sketch: SketchNode): ParametricBodyNode {
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 15 }],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return body;
}

function revolveBody(doc: TestDocument, sketch: SketchNode): ParametricBodyNode {
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "r1",
                type: "revolve",
                sketchId: sketch.id,
                axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                angle: 270,
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return body;
}

function setupBody(
    build: (doc: TestDocument, sketch: SketchNode) => ParametricBodyNode,
    plane: Plane,
    data: SketchData,
) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, id: "sk1", plane, data });
    doc.modelManager.addNode(sketch);
    return { doc, sketch, body: build(doc, sketch) };
}

function facesOf(body: ParametricBodyNode): IFace[] {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
}

function centerOf(face: IFace): XYZ {
    const box = face.boundingBox();
    return new XYZ({
        x: (box.min.x + box.max.x) / 2,
        y: (box.min.y + box.max.y) / 2,
        z: (box.min.z + box.max.z) / 2,
    });
}

const round = (value: number) => {
    const r = Math.round(value * 1e6) / 1e6;
    return r === 0 ? 0 : r;
};

const byCoords = (a: number[], b: number[]) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] ?? 0) - (b[3] ?? 0);

/** id → geometry of every face and of the geometry-stable edges (see below). */
function idSnapshot(body: ParametricBodyNode) {
    const shape = body.shape.unchecked()!;
    const faces: Record<string, number[][]> = {};
    for (const [index, face] of (shape.findSubShapes(ShapeTypes.face) as IFace[]).entries()) {
        const id = body.faceIdAt(index) ?? "?";
        const center = centerOf(face);
        const entry = [round(center.x), round(center.y), round(center.z), round(face.area())];
        if (faces[id] === undefined) faces[id] = [entry];
        else faces[id].push(entry);
    }
    const edges: Record<string, number[][][]> = {};
    for (const [index, edge] of (shape.findSubShapes(ShapeTypes.edge) as IEdge[]).entries()) {
        const id = body.edgeIdAt(index) ?? "?";
        // Feature-scoped positional ids (`e1:N`) realign onto other sub-shapes when
        // the kernel re-enumerates geometry — that is their documented trade-off.
        // Only the entity-derived seeds are geometry-stable across a mirrored rebuild.
        if (/^e1:\d+$/.test(id)) continue;
        // The mid sample is the bbox center: pointAt reads the curve's native
        // parameter, which flips with the edge's direction on a rewound rebuild.
        const box = edge.boundingBox();
        const mid = new XYZ({
            x: (box.min.x + box.max.x) / 2,
            y: (box.min.y + box.max.y) / 2,
            z: (box.min.z + box.max.z) / 2,
        });
        const points = [edge.startPoint(), mid, edge.endPoint()]
            .map((p) => [round(p.x), round(p.y), round(p.z)])
            .sort(byCoords);
        if (edges[id] === undefined) edges[id] = [points];
        else edges[id].push(points);
    }
    for (const list of Object.values(faces)) list.sort(byCoords);
    for (const list of Object.values(edges)) list.sort((a, b) => byCoords(a[0], b[0]));
    return { faces, edges };
}

describe("sweep cap ids from the kernel cap channel (real kernel)", () => {
    test("a holed profile's top face carries :top, stable across a mirrored rebuild", () => {
        const { sketch, body } = setupBody(extrudeBody, Plane.XY, holedRect(false));
        // The geometric top: planar, horizontal normal, centered at z = depth.
        const topIndex = () =>
            facesOf(body).findIndex((face) => {
                if (!face.surface().isPlanar()) return false;
                const normal = face.normal(0, 0)[1];
                return Math.abs(Math.abs(normal.z) - 1) < 1e-6 && Math.abs(centerOf(face).z - 15) < 1e-6;
            });
        expect(topIndex()).toBeGreaterThanOrEqual(0);
        const topId = body.faceIdAt(topIndex());
        // The kernel reports the cap directly — not a positional `e1:N` fallback.
        expect(topId).toMatch(/^sketch:sk1:e[\d.]+:top$/);
        // Exactly one face carries a :top id.
        const topIds = facesOf(body).filter((_, index) => body.faceIdAt(index)?.endsWith(":top"));
        expect(topIds).toHaveLength(1);
        const before = idSnapshot(body);

        sketch.setDataEmitShapeChanged(holedRect(true));

        expect(body.shape.isOk).toBe(true);
        expect(topIndex()).toBeGreaterThanOrEqual(0);
        expect(body.faceIdAt(topIndex())).toBe(topId);
        // Face ids and entity-derived edge ids keep indexing the same geometry.
        expect(idSnapshot(body)).toEqual(before);
    });

    test("a partial revolve's end cap carries :cap, the start cap the plain seed", () => {
        const { sketch, body } = setupBody(revolveBody, XZ_PLANE, rect(false));
        // The 270° end cap: the planar radial face perpendicular to the start cap.
        const endCapIndex = () =>
            facesOf(body).findIndex((face) => {
                if (!face.surface().isPlanar()) return false;
                const normal = face.normal(0, 0)[1];
                return Math.abs(normal.z) < 0.5 && Math.abs(normal.x) > 0.9;
            });
        expect(endCapIndex()).toBeGreaterThanOrEqual(0);
        const capId = body.faceIdAt(endCapIndex());
        expect(capId).toMatch(/^sketch:sk1:e[\d.]+:cap$/);
        // Exactly one face carries a :cap id.
        const capIds = facesOf(body).filter((_, index) => body.faceIdAt(index)?.endsWith(":cap"));
        expect(capIds).toHaveLength(1);
        // The start cap keeps the unsuffixed profile seed.
        const startCapId = capId!.replace(/:cap$/, "");
        const startIndex = body.faceIndexById(startCapId);
        expect(startIndex).toBeDefined();
        const startNormal = facesOf(body)[startIndex!].normal(0, 0)[1];
        expect(Math.abs(Math.abs(startNormal.y) - 1)).toBeLessThan(1e-6);

        sketch.setDataEmitShapeChanged(rect(true));

        expect(body.shape.isOk).toBe(true);
        expect(endCapIndex()).toBeGreaterThanOrEqual(0);
        expect(body.faceIdAt(endCapIndex())).toBe(capId);
        expect(body.faceIndexById(startCapId)).toBeDefined();
    });

    test("a full turn reports no cap and keeps the geometric ring probe", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({ document: doc, id: "sk1", plane: XZ_PLANE, data: rect(false) });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [
                {
                    id: "r1",
                    type: "revolve",
                    sketchId: sketch.id,
                    axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                    angle: 360,
                },
            ],
        });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);
        // No :cap is seeded at 360°; the end rings still take the sweeping edges'
        // seeds via the unchanged geometric probe.
        const ids = facesOf(body).map((_, index) => body.faceIdAt(index)!);
        expect(ids.some((id) => id.endsWith(":cap"))).toBe(false);
        const rings = facesOf(body).flatMap((face, index) => {
            if (!face.surface().isPlanar()) return [];
            return Math.abs(face.normal(0, 0)[1].z) > 0.9 ? [index] : [];
        });
        expect(rings).toHaveLength(2);
        for (const index of rings) expect(body.faceIdAt(index)).toMatch(/^sketch:sk1:e[\d.]+:ent\d+$/);
    });
});
