// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef, edgeMidPoint } from "../src/features/edgeRef";
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

/** A filleted box: its TRIMMED edges have curve parameters that start away from zero. */
function filletedBox(doc: TestDocument): IEdge[] {
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 40, 20) });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 10 }],
    });
    doc.modelManager.addNode(body);
    const verticals = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => {
            const s = edge.startPoint();
            const e = edge.endPoint();
            return Math.abs(s.x - e.x) < 1e-6 && Math.abs(s.y - e.y) < 1e-6 && Math.abs(s.z - e.z) > 1e-6;
        })
        .map(({ edge, index }) => captureEdgeRef(edge, body.edgeIdAt(index), false));
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id: "f1", type: "fillet", radius: 2, edges: verticals },
    ]);
    expect(body.featureItems()[1].error).toBeUndefined();
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
}

test("an edge's midpoint is its range's middle, not curve parameter 0.5", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    // The premise this suite exists for: `IEdge.pointAt` takes the curve's OWN parameter, so a
    // trimmed edge's range can exclude 0.5 entirely (measured here: a line spanning [2, 38], an
    // arc spanning [3.142, 4.712], where 0.5 is outside the sweep).
    const edge = filletedBox(doc).find(
        (candidate) =>
            candidate.curve.basisCurve.curveType === "line" &&
            candidate.firstParameter() > 0.5 &&
            candidate.firstParameter() < candidate.lastParameter(),
    );
    expect(edge).toBeDefined();

    const start = edge!.startPoint();
    const end = edge!.endPoint();
    const segmentMiddle = start.add(end.sub(start).multiply(0.5));

    // The midpoint helper returns the geometric middle — no curve parameter in sight.
    expect(edgeMidPoint(edge!).distanceTo(segmentMiddle)).toBeLessThan(1e-6);
    // …while the raw parameter 0.5 lands millimetres away on this edge: the trap it exists for.
    expect(edge!.pointAt(0.5).distanceTo(segmentMiddle)).toBeGreaterThan(1);
});
