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

function faceCount(body: ParametricBodyNode): number {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face).length;
}

/** Line edges of the body's current shape lying on the front bottom edge (y=-20, z=0). */
function frontBottomEdgePieces(body: ParametricBodyNode): { edge: IEdge; index: number }[] {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    return edges
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
}

/**
 * The user's scenario: sketch1 extruded to a box; sketch2 on its side face with one
 * edge coincident with the box's bottom edge; the join bump splits that edge into
 * two pieces sharing one tracked id. A fillet on one piece must not widen to the
 * other when an upstream edit moves the pieces. Here the pieces are moved by
 * widening sketch1 (the same re-match path the depth edit of the report takes:
 * both id hits fail the stale fingerprint exactly).
 */
test("a fillet on one piece of a split edge does not widen to the other piece after an upstream edit", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-20, -20, 20, 20) });
    doc.modelManager.addNode(sketch1);
    const profiles1 = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(profiles1.length).toBe(1);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch1.id,
                depth: 20,
                profiles: [captureProfileRef(profiles1[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // sketch2 on the front face (y=-20): rectangle x in [-10,10], z in [0,8] — its
    // bottom edge lies on the box's front bottom edge.
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
    const sketch2 = new SketchNode({
        document: doc,
        plane,
        data: {
            entities: [
                { id: 1, type: "line", params: [...corners[0], ...corners[1]] },
                { id: 2, type: "line", params: [...corners[1], ...corners[2]] },
                { id: 3, type: "line", params: [...corners[2], ...corners[3]] },
                { id: 4, type: "line", params: [...corners[3], ...corners[0]] },
            ],
            constraints: [],
        },
    });
    doc.modelManager.addNode(sketch2);
    const profiles2 = sketch2.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(profiles2.length).toBe(1);

    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "extrude",
            sketchId: sketch2.id,
            depth: 10,
            operation: "fuse",
            profiles: [captureProfileRef(profiles2[0].shape as unknown as IFace)],
        },
    ]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

    // The merge split the front bottom edge into two surviving pieces
    // ([-20,-10] and [10,20]); both keep the original edge's tracked id.
    const pieces = frontBottomEdgePieces(body);
    expect(pieces.length).toBe(2);
    const ids = pieces.map(({ index }) => body.edgeIdAt(index));
    expect(ids[0]).toBeDefined();
    expect(ids[0]).toBe(ids[1]);

    // Fillet the right-hand piece (x in [10,20]) — captured as the command captures it.
    const right = pieces.find(({ edge }) => edge.startPoint().x > 0 || edge.endPoint().x > 0);
    expect(right).toBeDefined();
    const edgeId = body.edgeIdAt(right!.index);
    const ref = captureEdgeRef(right!.edge, edgeId, body.edgeIdIsShared(edgeId));
    expect(ref.splitPiece).toBe(true);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id: "f1", type: "fillet", radius: 2, edges: [ref] },
    ]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    const filletedFaces = faceCount(body);

    // Widen sketch1 along x: the split pieces move to [-30,-10] and [10,30], both
    // failing the stale fingerprint exactly — the fillet must follow only its own piece.
    sketch1.setDataEmitShapeChanged(rect(-30, -20, 30, 20));
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    expect(faceCount(body)).toBe(filletedFaces);
});
