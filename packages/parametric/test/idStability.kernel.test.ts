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
 * The tracked ids that name MORE THAN ONE sub-shape of the current shape, as
 * `"<kind> x<count> <id>"` — the collision a corner pass must never produce.
 *
 * Pieces of a split sub-shape sharing an id is designed (`idSnapshot` lists them together), so
 * this is read per OPERATION: a corner derives its names from the input edge it was built on, and
 * two corners on the two pieces of ONE split input edge derive from the same stem.
 */
function sharedIds(body: ParametricBodyNode): string[] {
    const shape = body.shape.unchecked()!;
    const kinds: [string, readonly (string | undefined)[]][] = [
        ["face", (shape.findSubShapes(ShapeTypes.face) as IFace[]).map((_, index) => body.faceIdAt(index))],
        ["edge", (shape.findSubShapes(ShapeTypes.edge) as IEdge[]).map((_, index) => body.edgeIdAt(index))],
    ];
    const shared: string[] = [];
    for (const [kind, ids] of kinds) {
        const counts = new Map<string, number>();
        for (const id of ids) {
            if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        for (const [id, count] of counts) {
            if (count > 1) shared.push(`${kind} x${count} ${id}`);
        }
    }
    return shared;
}

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
                "sketch:sk1:e1.2.3.4:v2.3": [
                    [
                        [20, 20, 0],
                        [20, 20, 0.5],
                        [20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:v3.4": [
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
                "sketch:sk1:e1.2.3.4:ent3:top": [
                    [
                        [-20, 20, 20],
                        [19.5, 20, 20],
                        [20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:v1.4": [
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
                "sketch:sk1:e1.2.3.4:ent4:top": [
                    [
                        [-20, -20, 20],
                        [-20, 19.5, 20],
                        [-20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:v1.2": [
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
                "sketch:sk1:e1.2.3.4:ent1:top": [
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
                "sketch:sk1:e1.2.3.4:ent2:top": [
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
                "sketch:sk1:e1.2.3.4:neg:v2.3|sketch:sk1:e1.2.3.4:v2.3": [
                    [
                        [20, 20, -20],
                        [20, 20, 19.5],
                        [20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent3:top": [
                    [
                        [-20, 20, 20],
                        [19.5, 20, 20],
                        [20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:neg:v3.4|sketch:sk1:e1.2.3.4:v3.4": [
                    [
                        [-20, 20, -20],
                        [-20, 20, -19.5],
                        [-20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:neg:ent3:top": [
                    [
                        [-20, 20, -20],
                        [19.5, 20, -20],
                        [20, 20, -20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:neg:ent4:top": [
                    [
                        [-20, -20, -20],
                        [-20, 19.5, -20],
                        [-20, 20, -20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:neg:ent1:top": [
                    [
                        [-20, -20, -20],
                        [-19.5, -20, -20],
                        [20, -20, -20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:neg:ent2:top": [
                    [
                        [20, -20, -20],
                        [20, -19.5, -20],
                        [20, 20, -20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent1:top": [
                    [
                        [-20, -20, 20],
                        [-19.5, -20, 20],
                        [20, -20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:neg:v1.2|sketch:sk1:e1.2.3.4:v1.2": [
                    [
                        [20, -20, -20],
                        [20, -20, 19.5],
                        [20, -20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:neg:v1.4|sketch:sk1:e1.2.3.4:v1.4": [
                    [
                        [-20, -20, -20],
                        [-20, -20, -19.5],
                        [-20, -20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent4:top": [
                    [
                        [-20, -20, 20],
                        [-20, 19.5, 20],
                        [-20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent2:top": [
                    [
                        [20, -20, 20],
                        [20, -19.5, 20],
                        [20, 20, 20],
                    ],
                ],
            },
            faces: {
                "sketch:sk1:e1.2.3.4:ent3|sketch:sk1:e1.2.3.4:neg:ent3": [[0, 20, 0, 1600]],
                "sketch:sk1:e1.2.3.4:neg:top": [[0, 0, -20, 1600]],
                "sketch:sk1:e1.2.3.4:ent1|sketch:sk1:e1.2.3.4:neg:ent1": [[0, -20, 0, 1600]],
                "sketch:sk1:e1.2.3.4:ent4|sketch:sk1:e1.2.3.4:neg:ent4": [[-20, 0, 0, 1600]],
                "sketch:sk1:e1.2.3.4:top": [[0, 0, 20, 1600]],
                "sketch:sk1:e1.2.3.4:ent2|sketch:sk1:e1.2.3.4:neg:ent2": [[20, 0, 0, 1600]],
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
                "sketch:sk1:e1.2.3.4:v1.2": [
                    [
                        [20, -20, 0.5],
                        [20, -20, 2],
                        [20, -20, 20],
                    ],
                ],
                "f1:sketch:sk1:e1.2.3.4:ent1:fsketch:sk1:e1.2.3.4:ent2": [
                    [
                        [20, -20, 2],
                        [20, -18, 0],
                        [20, -17.041149, 3.755165],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent2:top": [
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
                "sketch:sk1:e1.2.3.4:v2.3": [
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
                "f1:sketch:sk1:e1.2.3.4:ent1:fsketch:sk1:e1.2.3.4:ent1": [
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
                "sketch:sk1:e1.2.3.4:ent1:top": [
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
                "sketch:sk1:e1.2.3.4:v1.4": [
                    [
                        [-20, -20, 0],
                        [-20, -20, 0.5],
                        [-20, -20, 20],
                    ],
                ],
                "f1:sketch:sk1:e1.2.3.4:ent1:fsketch:sk2:e1.2.3.4:ent2": [
                    [
                        [10, -20, 2],
                        [10, -18, 0],
                        [10, -17.041149, 3.755165],
                    ],
                ],
                "f1:sketch:sk1:e1.2.3.4:ent1:fsketch:sk1:e1.2.3.4^sketch:sk2:e1.2.3.4:ent1": [
                    [
                        [10, -18, 0],
                        [10.5, -18, 0],
                        [20, -18, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent3:top": [
                    [
                        [-20, 20, 20],
                        [19.5, 20, 20],
                        [20, 20, 20],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:ent4:top": [
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
                "f1:sketch:sk1:e1.2.3.4^sketch:sk2:e1.2.3.4:ent1&sketch:sk2:e1.2.3.4:ent2": [
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
                "sketch:sk2:e1.2.3.4:v1.2": [
                    [
                        [10, -30, 0],
                        [10, -20.5, 0],
                        [10, -20, 0],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:ent1:top": [
                    [
                        [-10, -30, 0],
                        [-9.5, -30, 0],
                        [10, -30, 0],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:v1.4": [
                    [
                        [-10, -30, 0],
                        [-10, -20.5, 0],
                        [-10, -20, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:v3.4": [
                    [
                        [-20, 20, 0],
                        [-20, 20, 0.5],
                        [-20, 20, 20],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:v2.3": [
                    [
                        [10, -30, 8],
                        [10, -20.5, 8],
                        [10, -20, 8],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:ent2:top": [
                    [
                        [10, -30, 0],
                        [10, -30, 0.5],
                        [10, -30, 8],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:v3.4": [
                    [
                        [-10, -30, 8],
                        [-10, -20.5, 8],
                        [-10, -20, 8],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:ent3:top": [
                    [
                        [-10, -30, 8],
                        [9.5, -30, 8],
                        [10, -30, 8],
                    ],
                ],
                "sketch:sk2:e1.2.3.4:ent4:top": [
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
                "f1:sketch:sk1:e1.2.3.4:ent1:f": [[15, -19, 1, 31.415927]],
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

    test("two fillets on the two pieces of a split edge each get their own ids", () => {
        // Both corners are built on ONE logical input edge: the front bottom edge the fused bump
        // split in two, whose pieces share `...:ent1` by design. Both corners therefore derive
        // their names from the same stem — `<inputEdgeId>:f<inheritedFace>` for a seam, and
        // `<inputEdgeId>:f` for the surface — and the two pieces border the SAME face pair, so
        // without the feature scope (`prefixedId`) every one of those names comes out identical:
        // measured before it, `face x2 sketch:sk1:e1.2.3.4:ent1:f` plus two `edge x2 ...`, with
        // every feature row reporting NO error — one name on two faces 30mm apart, which
        // `idsOverlap` then reads as pieces of a single split sub-shape. The overlap guard alone
        // could only drop the second claim, leaving one corner unnamed; the scope names both, each
        // under the feature that built it.
        const doc = setup();
        const body = extrudeBody(doc, addSketch(doc, "sk1", Plane.XY, rect(-20, -20, 20, 20)));
        const front = (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).find(
            (face) => face.normal(0, 0)[1].y < -1 + 1e-6,
        )!;
        const plane = sketchPlaneOfFace(front);
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

        /** The two pieces of the split front bottom edge, as they stand right now. */
        const pieces = () =>
            (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])
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

        // Fillet the right piece, then — from the shape that leaves — the left one, each
        // captured the way the command captures it (id + the shared flag).
        const addFillet = (id: string, rightward: boolean) => {
            const piece = pieces().find(
                ({ edge }) => edge.startPoint().x + edge.endPoint().x > 0 === rightward,
            );
            expect(piece).toBeDefined();
            const edgeId = body.edgeIdAt(piece!.index);
            // The premise of the whole test: the piece still answers to the split edge's own id,
            // whichever of the two pieces it is — the single stem both corners derive from.
            expect(edgeId).toBe("sketch:sk1:e1.2.3.4:ent1");
            body.setFeaturesEmitShapeChanged([
                ...body.features,
                {
                    id,
                    type: "fillet",
                    radius: 2,
                    edges: [captureEdgeRef(piece!.edge, edgeId, body.edgeIdIsShared(edgeId))],
                },
            ]);
        };
        addFillet("f1", true);
        addFillet("f2", false);

        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined, undefined]);
        expect(sharedIds(body)).toEqual([]);
        // BOTH corner surfaces are named, each under its own feature — the ids are the same except
        // for the scope, which is the whole point of carrying it.
        const faceIds = (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).map((_, index) =>
            body.faceIdAt(index),
        );
        const surfaces = faceIds.filter((id) => id?.endsWith(":ent1:f")).sort();
        expect(surfaces).toEqual(["f1:sketch:sk1:e1.2.3.4:ent1:f", "f2:sketch:sk1:e1.2.3.4:ent1:f"]);
        // A reference captured on either surface resolves to that one piece only.
        for (const id of surfaces) {
            expect(body.faceIndexesOfId(id!)).toHaveLength(1);
            expect(body.faceIdIsShared(id)).toBe(false);
        }
        // Nothing was traded away for it: no face is left unnamed (one was, before the scope).
        expect(faceIds.filter((id) => id === undefined)).toEqual([]);
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
                "sketch:sk1:e1.2.3.4:v2.3": [
                    [
                        [-10, 15, 0],
                        [8.369483, 15.967209, 0],
                        [15, 10, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:v3.4": [
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
                "sketch:sk1:e1.2.3.4:ent3:cap": [
                    [
                        [-10, 5, 0],
                        [-10, 14.5, 0],
                        [-10, 15, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:v1.4": [
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
                "sketch:sk1:e1.2.3.4:ent4:cap": [
                    [
                        [-10, 5, 0],
                        [-9.5, 5, 0],
                        [0, 5, 0],
                    ],
                ],
                "sketch:sk1:e1.2.3.4:v1.2": [
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
                "sketch:sk1:e1.2.3.4:ent1:cap": [
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
                "sketch:sk1:e1.2.3.4:ent2:cap": [
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
