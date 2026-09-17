// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * A revolve whose axis edge lives on the HOST body itself must resolve the axis
 * against the feature's input (the shape entering the revolve in the current
 * run), not the body's committed shape — mid-rebuild the committed shape is the
 * pre-run result, so resolving there sweeps around the stale axis and a
 * downstream failure would wedge the chain (same contract as press-pull source
 * faces, see `resolveSourceFaces`). No command creates a self-sourced axis today
 * (the revolve command builds standalone bodies); this locks the contract for
 * when one does. The profile sketch uses a fixed plane so the axis edge is the
 * only thing the upstream edit moves.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { RevolveFeatureData } from "../src/features/feature";
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

const loop = (x1: number, y1: number, x2: number, y2: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x1, y1, x2, y1] },
        { id: 2, type: "line", params: [x2, y1, x2, y2] },
        { id: 3, type: "line", params: [x2, y2, x1, y2] },
        { id: 4, type: "line", params: [x1, y2, x1, y1] },
    ],
    constraints: [],
});

interface Setup {
    doc: TestDocument;
    body: ParametricBodyNode;
    sketch1: SketchNode;
}

/**
 * Box w×40×40 from sketch1; a small square profile on the top face (fixed plane
 * at z=40); a full-turn revolve of the square around the box's top-right edge
 * (the line x=w, z=40 along Y) referenced LIVE from the host body.
 */
function build(w: number): Setup {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: loop(0, 0, w, 40) });
    doc.modelManager.addNode(sketch1);
    const profiles1 = sketch1.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch1.id,
                depth: 40,
                profiles: [captureProfileRef(profiles1[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const axisIndex = edges.findIndex((edge) => {
        const start = edge.startPoint();
        const end = edge.endPoint();
        return (
            Math.abs(start.x - w) < 1e-6 &&
            Math.abs(end.x - w) < 1e-6 &&
            Math.abs(start.z - 40) < 1e-6 &&
            Math.abs(end.z - 40) < 1e-6 &&
            Math.abs(start.y - end.y) > 1e-6
        );
    });
    expect(axisIndex).toBeGreaterThanOrEqual(0);

    const sketch2 = new SketchNode({
        document: doc,
        plane: new Plane({ origin: new XYZ({ x: 0, y: 0, z: 40 }), normal: XYZ.unitZ, xvec: XYZ.unitX }),
        data: loop(32, 4, 36, 8),
    });
    doc.modelManager.addNode(sketch2);
    const profiles2 = sketch2.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(profiles2.length).toBe(1);

    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "e2",
            type: "revolve",
            sketchId: sketch2.id,
            angle: 360,
            axis: { point: { x: w, y: 0, z: 40 }, direction: { x: 0, y: 1, z: 0 } },
            axisSource: { nodeId: body.id, edge: captureEdgeRef(edges[axisIndex], body.edgeIdAt(axisIndex)) },
            profiles: [captureProfileRef(profiles2[0].shape as unknown as IFace)],
        } as RevolveFeatureData,
    ]);
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
    return { doc, body, sketch1 };
}

const errors = (body: ParametricBodyNode): (string | undefined)[] => body.featureItems().map((x) => x.error);

test("the self-sourced axis follows the upstream edit mid-chain (edit ≡ fresh build)", () => {
    const edited = build(40);
    edited.sketch1.setDataEmitShapeChanged(loop(0, 0, 20, 40));
    expect(errors(edited.body)).toEqual([undefined, undefined]);

    const fresh = build(20);
    const editedBox = edited.body.shape.unchecked()!.boundingBox();
    const freshBox = fresh.body.shape.unchecked()!.boundingBox();
    for (const corner of ["min", "max"] as const) {
        expect(editedBox[corner].x).toBeCloseTo(freshBox[corner].x);
        expect(editedBox[corner].y).toBeCloseTo(freshBox[corner].y);
        expect(editedBox[corner].z).toBeCloseTo(freshBox[corner].z);
    }
    // The torus around the MOVED axis sits at x≈20 — a stale (committed-shape)
    // axis would keep it around x≈40 (x∈[32,48]). Coarse precision: the bbox
    // comes from discretized curved surfaces, so it sits slightly inside.
    expect(editedBox.min.x).toBeCloseTo(4, 0);
    expect(editedBox.max.x).toBeCloseTo(36, 0);

    // The stored ref keeps its PICK-TIME fingerprint (x=40): an id-hit does not
    // re-anchor — the stored ref encodes what the user picked, and the live id is
    // what followed the edit (proven by the bbox moving). Re-anchoring on id-hits
    // would rewrite user intent every rebuild.
    const axisRef = (edited.body.features.find((f) => f.id === "e2") as RevolveFeatureData).axisSource!.edge;
    expect(axisRef.kind).toBe("line");
    if (axisRef.kind === "line") {
        expect(axisRef.start.x).toBeCloseTo(40);
    }
});
