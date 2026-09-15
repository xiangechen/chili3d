// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchData } from "../src/sketch/sketchModel";
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

/**
 * Areas of the body's curved faces (the fillet cylinders) — a plane's normal is
 * constant, a fillet's varies along the arc. A radius-2 quarter fillet over an edge
 * of length L has area π·L.
 */
function filletFaceAreas(body: ParametricBodyNode): number[] {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    return faces
        .filter((face) => face.normal(0, 0)[1].sub(face.normal(0.25, 0)[1]).length() > 1e-3)
        .map((face) => face.area())
        .sort((a, b) => b - a);
}

/** Line edges of the body's current shape lying on the top front line (y=-20) at `z`. */
function topFrontEdgesAt(body: ParametricBodyNode, z: number): { edge: IEdge; index: number }[] {
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
                Math.abs(s.z - z) < 1e-6 &&
                Math.abs(e.z - z) < 1e-6
            );
        });
}

/**
 * Box (sketch1, x,y∈[-20,20]×[0,20]) with a same-height boss fused beside it
 * (sketch2, x∈[20,40], y∈[-20,0], sharing the front plane): the fuse merges the
 * box's and the boss's collinear top-front edges into one 60-long edge whose tracked
 * id is a compound of both ancestors. A fillet on that edge must follow BOTH pieces
 * when deepening sketch1 re-splits them at different heights.
 */
test("a fillet on a merged collinear edge follows both pieces after an upstream edit", () => {
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

    const sketch2 = new SketchNode({ document: doc, plane: Plane.XY, data: rect(20, -20, 40, 0) });
    doc.modelManager.addNode(sketch2);
    const profiles2 = sketch2.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(profiles2.length).toBe(1);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "extrude",
            sketchId: sketch2.id,
            depth: 20,
            operation: "fuse",
            profiles: [captureProfileRef(profiles2[0].shape as unknown as IFace)],
        },
    ]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

    // The merged top-front edge (x∈[-20,40] at y=-20, z=20) carries a compound id.
    const merged = topFrontEdgesAt(body, 20);
    expect(merged.length).toBe(1);
    expect(merged[0].edge.length()).toBeCloseTo(60, 6);
    const edgeId = body.edgeIdAt(merged[0].index);
    expect(edgeId?.includes("|")).toBe(true);

    // Fillet the merged edge — captured as the command captures it. One fillet face
    // (π·60) covers the whole merged span.
    const ref = captureEdgeRef(merged[0].edge, edgeId, body.edgeIdIsShared(edgeId));
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id: "f1", type: "fillet", radius: 2, edges: [ref] },
    ]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    expect(filletFaceAreas(body).length).toBe(1);
    expect(filletFaceAreas(body)[0]).toBeCloseTo(Math.PI * 60, 1);

    // Deepen sketch1 20 → 40: the box's top-front piece rises to z=40 (40 long), the
    // boss's stays at z=20 (20 long). The compound id intersects both pieces, so the
    // fillet covers both — two fillet faces (π·40 and π·20).
    body.setFeaturesEmitShapeChanged(body.features.map((f) => (f.id === "e1" ? { ...f, depth: 40 } : f)));
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    const areas = filletFaceAreas(body);
    expect(areas.length).toBe(2);
    expect(areas[0]).toBeCloseTo(Math.PI * 40, 1);
    expect(areas[1]).toBeCloseTo(Math.PI * 20, 1);
});
