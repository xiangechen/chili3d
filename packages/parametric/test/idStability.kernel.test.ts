// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { sketchPlaneOfFace } from "../src/sketch/planeRef";
import { type SketchData, toUV } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";
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

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

function addSketch(doc: TestDocument, id: string, plane: Plane, data: SketchData) {
    const sketch = new SketchNode({ document: doc, id, plane, data });
    doc.modelManager.addNode(sketch);
    return sketch;
}

function profileOf(sketch: SketchNode): IFace {
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(profiles).toHaveLength(1);
    return profiles[0].shape as unknown as IFace;
}

function extrudeBody(
    doc: TestDocument,
    sketch: SketchNode,
    extra: Record<string, unknown> = {},
): ParametricBodyNode {
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 20,
                profiles: [captureProfileRef(profileOf(sketch))],
                ...extra,
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return body;
}

const round = (value: number) => {
    const r = Math.round(value * 1e6) / 1e6;
    return r === 0 ? 0 : r;
};

const byCoords = (a: number[], b: number[]) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] ?? 0) - (b[3] ?? 0);

/**
 * id → geometry of every edge and face of the body: edges as sorted [start, mid,
 * end] coordinate triples (orientation-insensitive), faces as [center, area].
 * One id can list several entries — split pieces share their tracked id.
 */
function idSnapshot(body: ParametricBodyNode) {
    const shape = body.shape.unchecked()!;
    const push = <T>(record: Record<string, T[]>, id: string, value: T) => {
        const list = record[id];
        if (list === undefined) record[id] = [value];
        else list.push(value);
    };
    const edges: Record<string, number[][][]> = {};
    for (const [index, edge] of (shape.findSubShapes(ShapeTypes.edge) as IEdge[]).entries()) {
        const id = body.edgeIdAt(index) ?? "?";
        const points = [edge.startPoint(), edge.pointAt(0.5), edge.endPoint()]
            .map((p) => [round(p.x), round(p.y), round(p.z)])
            .sort(byCoords);
        push(edges, id, points);
    }
    const faces: Record<string, number[][]> = {};
    for (const [index, face] of (shape.findSubShapes(ShapeTypes.face) as IFace[]).entries()) {
        const id = body.faceIdAt(index) ?? "?";
        const box = face.boundingBox();
        const cx = round(((box?.min.x ?? 0) + (box?.max.x ?? 0)) / 2);
        const cy = round(((box?.min.y ?? 0) + (box?.max.y ?? 0)) / 2);
        const cz = round(((box?.min.z ?? 0) + (box?.max.z ?? 0)) / 2);
        push(faces, id, [cx, cy, cz, round(face.area())]);
    }
    for (const list of Object.values(edges)) list.sort((a, b) => byCoords(a[0], b[0]));
    for (const list of Object.values(faces)) list.sort(byCoords);
    return { edges, faces };
}

/**
 * Golden snapshots of the full id → geometry map of representative bodies. The id
 * scheme is a compatibility contract: any drift in seed derivation, feature-scoped
 * id formats, or history-completion behavior turns this suite red. When a change is
 * INTENTIONAL, regenerate the expectation by temporarily logging
 * `JSON.stringify(idSnapshot(body))` — and review the diff id by id.
 */
describe("golden id stability (real kernel)", () => {
    test("box extrude", () => {
        const doc = setup();
        const body = extrudeBody(doc, addSketch(doc, "sk1", Plane.XY, rect(-20, -20, 20, 20)));

        expect(idSnapshot(body)).toEqual({
            edges: {
                "e1:0": [
                    [
                        [20, 20, 0],
                        [20, 20, 0.5],
                        [20, 20, 20],
                    ],
                ],
                "e1:1": [
                    [
                        [-20, 20, 0],
                        [-20, 20, 0.5],
                        [-20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent3": [
                    [
                        [-20, 20, 0],
                        [19.5, 20, 0],
                        [20, 20, 0],
                    ],
                ],
                "e1:3": [
                    [
                        [-20, 20, 20],
                        [19.5, 20, 20],
                        [20, 20, 20],
                    ],
                ],
                "e1:4": [
                    [
                        [-20, -20, 0],
                        [-20, -20, 0.5],
                        [-20, -20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent4": [
                    [
                        [-20, -20, 0],
                        [-20, 19.5, 0],
                        [-20, 20, 0],
                    ],
                ],
                "e1:6": [
                    [
                        [-20, -20, 20],
                        [-20, 19.5, 20],
                        [-20, 20, 20],
                    ],
                ],
                "e1:7": [
                    [
                        [20, -20, 0],
                        [20, -20, 0.5],
                        [20, -20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent1": [
                    [
                        [-20, -20, 0],
                        [-19.5, -20, 0],
                        [20, -20, 0],
                    ],
                ],
                "e1:9": [
                    [
                        [-20, -20, 20],
                        [-19.5, -20, 20],
                        [20, -20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent2": [
                    [
                        [20, -20, 0],
                        [20, -19.5, 0],
                        [20, 20, 0],
                    ],
                ],
                "e1:11": [
                    [
                        [20, -20, 20],
                        [20, -19.5, 20],
                        [20, 20, 20],
                    ],
                ],
            },
            faces: {
                "sketch:sk1:e1.2.3.4:ent3": [[0, 20, 10, 800]],
                "sketch:sk1:e1.2.3.4:ent4": [[-20, 0, 10, 800]],
                "sketch:sk1:e1.2.3.4:ent1": [[0, -20, 10, 800]],
                "sketch:sk1:e1.2.3.4:ent2": [[20, 0, 10, 800]],
                "sketch:sk1:e1.2.3.4": [[0, 0, 0, 1600]],
                "sketch:sk1:e1.2.3.4:top": [[0, 0, 20, 1600]],
            },
        });
    });

    test("symmetric extrude", () => {
        const doc = setup();
        const body = extrudeBody(doc, addSketch(doc, "sk1", Plane.XY, rect(-20, -20, 20, 20)), {
            symmetric: true,
        });

        expect(idSnapshot(body)).toEqual({
            edges: {
                "e1:0": [
                    [
                        [20, 20, -20],
                        [20, 20, 19.5],
                        [20, 20, 20],
                    ],
                ],
                "e1:3": [
                    [
                        [-20, 20, 20],
                        [19.5, 20, 20],
                        [20, 20, 20],
                    ],
                ],
                "e1:1": [
                    [
                        [-20, 20, -20],
                        [-20, 20, -19.5],
                        [-20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:neg:ent3": [
                    [
                        [-20, 20, -20],
                        [19.5, 20, -20],
                        [20, 20, -20],
                    ],
                ],
                "e1:neg:4": [
                    [
                        [-20, -20, -20],
                        [-20, 19.5, -20],
                        [-20, 20, -20],
                    ],
                ],
                "e1:neg:6": [
                    [
                        [-20, -20, -20],
                        [-19.5, -20, -20],
                        [20, -20, -20],
                    ],
                ],
                "e1:neg:7": [
                    [
                        [20, -20, -20],
                        [20, -19.5, -20],
                        [20, 20, -20],
                    ],
                ],
                "e1:9": [
                    [
                        [-20, -20, 20],
                        [-19.5, -20, 20],
                        [20, -20, 20],
                    ],
                ],
                "e1:7": [
                    [
                        [20, -20, -20],
                        [20, -20, 19.5],
                        [20, -20, 20],
                    ],
                ],
                "e1:4": [
                    [
                        [-20, -20, -20],
                        [-20, -20, -19.5],
                        [-20, -20, 20],
                    ],
                ],
                "e1:6": [
                    [
                        [-20, -20, 20],
                        [-20, 19.5, 20],
                        [-20, 20, 20],
                    ],
                ],
                "e1:11": [
                    [
                        [20, -20, 20],
                        [20, -19.5, 20],
                        [20, 20, 20],
                    ],
                ],
            },
            faces: {
                "sketch:sk1:e1.2.3.4:ent3": [[0, 20, 0, 1600]],
                "sketch:sk1:e1.2.3.4:neg": [[0, 0, -20, 1600]],
                "sketch:sk1:e1.2.3.4:ent1": [[0, -20, 0, 1600]],
                "sketch:sk1:e1.2.3.4:ent4": [[-20, 0, 0, 1600]],
                "sketch:sk1:e1.2.3.4:top": [[0, 0, 20, 1600]],
                "sketch:sk1:e1.2.3.4:ent2": [[20, 0, 0, 1600]],
            },
        });
    });

    test("fuse bump splitting an edge, then fillet on one piece", () => {
        const doc = setup();
        const body = extrudeBody(doc, addSketch(doc, "sk1", Plane.XY, rect(-20, -20, 20, 20)));

        // sketch2 on the front face (y=-20), its bottom edge coincident with the
        // box's front bottom edge; fusing the bump splits that edge in two.
        const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const front = faces.find((face) => face.normal(0, 0)[1].y < -1 + 1e-6);
        expect(front).toBeDefined();
        const plane = sketchPlaneOfFace(front!);
        const corners = [
            new XYZ({ x: -10, y: -20, z: 0 }),
            new XYZ({ x: 10, y: -20, z: 0 }),
            new XYZ({ x: 10, y: -20, z: 8 }),
            new XYZ({ x: -10, y: -20, z: 8 }),
        ].map((p) => toUV(plane, p));
        const sketch2 = addSketch(doc, "sk2", plane, {
            entities: [
                { id: 1, type: "line", params: [...corners[0], ...corners[1]] },
                { id: 2, type: "line", params: [...corners[1], ...corners[2]] },
                { id: 3, type: "line", params: [...corners[2], ...corners[3]] },
                { id: 4, type: "line", params: [...corners[3], ...corners[0]] },
            ],
            constraints: [],
        });
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "e2",
                type: "extrude",
                sketchId: sketch2.id,
                depth: 10,
                operation: "fuse",
                profiles: [captureProfileRef(profileOf(sketch2))],
            },
        ]);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

        // Fillet the right-hand piece (x in [10,20]) of the split front bottom edge.
        const pieces = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])
            .map((edge, index) => ({ edge, index }))
            .filter(({ edge }) => {
                if (edge.curve.basisCurve.curveType !== "line") return false;
                const s = edge.startPoint();
                const e = edge.endPoint();
                return (
                    Math.abs(s.y + 20) < 1e-6 &&
                    Math.abs(e.y + 20) < 1e-6 &&
                    Math.abs(s.z) < 1e-6 &&
                    Math.abs(e.z) < 1e-6
                );
            });
        expect(pieces).toHaveLength(2);
        const right = pieces.find(({ edge }) => edge.startPoint().x > 0 || edge.endPoint().x > 0);
        expect(right).toBeDefined();
        const edgeId = body.edgeIdAt(right!.index);
        const ref = captureEdgeRef(right!.edge, edgeId, body.edgeIdIsShared(edgeId));
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            { id: "f1", type: "fillet", radius: 2, edges: [ref] },
        ]);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);

        expect(idSnapshot(body)).toEqual({
            edges: {
                "e1:7": [
                    [
                        [20, -20, 0.5],
                        [20, -20, 2],
                        [20, -20, 20],
                    ],
                ],
                "f1:1": [
                    [
                        [20, -20, 2],
                        [20, -18, 0],
                        [20, -17.041149, 3.755165],
                    ],
                ],
                "e1:11": [
                    [
                        [20, -20, 20],
                        [20, -19.5, 20],
                        [20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent2": [
                    [
                        [20, -19.5, 0],
                        [20, -18, 0],
                        [20, 20, 0],
                    ],
                ],
                "e1:0": [
                    [
                        [20, 20, 0],
                        [20, 20, 0.5],
                        [20, 20, 20],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:ent2": [
                    [
                        [10, -20, 0.5],
                        [10, -20, 2],
                        [10, -20, 8],
                    ],
                ],
                "f1:6": [
                    [
                        [10, -20, 2],
                        [10.5, -20, 2],
                        [20, -20, 2],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:ent3": [
                    [
                        [-10, -20, 8],
                        [9.5, -20, 8],
                        [10, -20, 8],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:ent4": [
                    [
                        [-10, -20, 0],
                        [-10, -20, 7.5],
                        [-10, -20, 8],
                    ],
                ],
                "e1:9": [
                    [
                        [-20, -20, 20],
                        [-19.5, -20, 20],
                        [20, -20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent1": [
                    [
                        [-20, -20, 0],
                        [-19.5, -20, 0],
                        [-10, -20, 0],
                    ],
                ],
                "e1:4": [
                    [
                        [-20, -20, 0],
                        [-20, -20, 0.5],
                        [-20, -20, 20],
                    ],
                ],
                "f1:12": [
                    [
                        [10, -20, 2],
                        [10, -18, 0],
                        [10, -17.041149, 3.755165],
                    ],
                ],
                "f1:13": [
                    [
                        [10, -18, 0],
                        [10.5, -18, 0],
                        [20, -18, 0],
                    ],
                ],
                "e1:3": [
                    [
                        [-20, 20, 20],
                        [19.5, 20, 20],
                        [20, 20, 20],
                    ],
                ],
                "e1:6": [
                    [
                        [-20, -20, 20],
                        [-20, 19.5, 20],
                        [-20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent3": [
                    [
                        [-20, 20, 0],
                        [19.5, 20, 0],
                        [20, 20, 0],
                    ],
                ],
                "f1:17": [
                    [
                        [10, -20, 0],
                        [10, -18, 0],
                        [10, -9.5, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent4": [
                    [
                        [-20, -20, 0],
                        [-20, 19.5, 0],
                        [-20, 20, 0],
                    ],
                ],
                "e2:7": [
                    [
                        [10, -30, 0],
                        [10, -20.5, 0],
                        [10, -20, 0],
                    ],
                ],
                "e2:9": [
                    [
                        [-10, -30, 0],
                        [-9.5, -30, 0],
                        [10, -30, 0],
                    ],
                ],
                "e2:4": [
                    [
                        [-10, -30, 0],
                        [-10, -20.5, 0],
                        [-10, -20, 0],
                    ],
                ],
                "e1:1": [
                    [
                        [-20, 20, 0],
                        [-20, 20, 0.5],
                        [-20, 20, 20],
                    ],
                ],
                "e2:0": [
                    [
                        [10, -30, 8],
                        [10, -20.5, 8],
                        [10, -20, 8],
                    ],
                ],
                "e2:11": [
                    [
                        [10, -30, 0],
                        [10, -30, 0.5],
                        [10, -30, 8],
                    ],
                ],
                "e2:1": [
                    [
                        [-10, -30, 8],
                        [-10, -20.5, 8],
                        [-10, -20, 8],
                    ],
                ],
                "e2:3": [
                    [
                        [-10, -30, 8],
                        [9.5, -30, 8],
                        [10, -30, 8],
                    ],
                ],
                "e2:6": [
                    [
                        [-10, -30, 0],
                        [-10, -30, 7.5],
                        [-10, -30, 8],
                    ],
                ],
            },
            faces: {
                "sketch:sk1:e1.2.3.4:ent2": [[20, 0, 10, 799.141593]],
                "sketch:sk1:e1.2.3.4:ent1": [[0, -20, 10, 620]],
                "f1:2": [[15, -19, 1, 31.415927]],
                "sketch:sk1:e1.2.3.4:top": [[0, 0, 20, 1600]],
                "sketch:sk1:e1.2.3.4|sketch:sk2:e1.2.3.4:ent1": [[0, -5, 0, 1780]],
                "sketch:sk1:e1.2.3.4:ent3": [[0, 20, 10, 800]],
                "sketch:sk2:e1.2.3.4:ent2": [[10, -24, 4, 80.858407]],
                "sketch:sk2:e1.2.3.4:ent3": [[0, -25, 8, 200]],
                "sketch:sk2:e1.2.3.4:ent4": [[-10, -25, 4, 80]],
                "sketch:sk1:e1.2.3.4:ent4": [[-20, 0, 10, 800]],
                "sketch:sk2:e1.2.3.4:top": [[0, -30, 4, 160]],
            },
        });
    });

    test("partial revolve", () => {
        const doc = setup();
        const sketch = addSketch(doc, "sk1", Plane.XY, rect(5, 0, 15, 10));
        const body = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [
                {
                    id: "r1",
                    type: "revolve",
                    sketchId: sketch.id,
                    axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                    angle: 90,
                    profiles: [captureProfileRef(profileOf(sketch))],
                },
            ],
        });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);

        expect(idSnapshot(body)).toEqual({
            edges: {
                "r1:0": [
                    [
                        [-10, 15, 0],
                        [8.369483, 15.967209, 0],
                        [15, 10, 0],
                    ],
                ],
                "r1:1": [
                    [
                        [-10, 5, 0],
                        [-0.406343, 11.172953, 0],
                        [5, 10, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent3": [
                    [
                        [5, 10, 0],
                        [14.5, 10, 0],
                        [15, 10, 0],
                    ],
                ],
                "r1:3": [
                    [
                        [-10, 5, 0],
                        [-10, 14.5, 0],
                        [-10, 15, 0],
                    ],
                ],
                "r1:4": [
                    [
                        [0, 5, 0],
                        [4.387913, 2.397128, 0],
                        [5, 0, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent4": [
                    [
                        [5, 0, 0],
                        [5, 9.5, 0],
                        [5, 10, 0],
                    ],
                ],
                "r1:6": [
                    [
                        [-10, 5, 0],
                        [-9.5, 5, 0],
                        [0, 5, 0],
                    ],
                ],
                "r1:7": [
                    [
                        [0, 15, 0],
                        [13.163738, 7.191383, 0],
                        [15, 0, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent1": [
                    [
                        [5, 0, 0],
                        [5.5, 0, 0],
                        [15, 0, 0],
                    ],
                ],
                "r1:9": [
                    [
                        [0, 5, 0],
                        [0, 5.5, 0],
                        [0, 15, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent2": [
                    [
                        [15, 0, 0],
                        [15, 0.5, 0],
                        [15, 10, 0],
                    ],
                ],
                "r1:11": [
                    [
                        [-10, 15, 0],
                        [-0.5, 15, 0],
                        [0, 15, 0],
                    ],
                ],
            },
            faces: {
                "sketch:sk1:e1.2.3.4:ent3": [[2.5, 11.513873, 0, 157.079633]],
                "sketch:sk1:e1.2.3.4:ent4": [[-2.5, 5.588098, 0, 78.539816]],
                "sketch:sk1:e1.2.3.4:ent1": [[7.5, 7.5, 0, 157.079633]],
                "sketch:sk1:e1.2.3.4:ent2": [[2.5, 9.013873, 0, 78.539816]],
                "sketch:sk1:e1.2.3.4": [[10, 5, 0, 100]],
                "sketch:sk1:e1.2.3.4:cap": [[-5, 10, 0, 100]],
            },
        });
    });
});
