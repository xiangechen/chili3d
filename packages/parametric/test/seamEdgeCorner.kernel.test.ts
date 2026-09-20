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

/** One side of the rectangle lies ON the Y axis, so the profile plane contains the axis. */
const RECT: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 10, 0] },
        { id: 2, type: "line", params: [10, 0, 10, 10] },
        { id: 3, type: "line", params: [10, 10, 0, 10] },
        { id: 4, type: "line", params: [0, 10, 0, 0] },
    ],
    constraints: [],
};

/** A body of revolution: a full turn leaves a SEAM where its first and last sections meet. */
function cylinder() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: RECT });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "r1",
                type: "revolve",
                sketchId: sketch.id,
                axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
                angle: 360,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return body;
}

/** The seam: the one line edge, with the SAME face on both sides. */
function seamEdgeIndex(body: ParametricBodyNode): number {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const index = edges.findIndex((edge) => edge.curve.basisCurve.curveType === "line");
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}

/** An end circle — an ordinary edge of the same body. */
function circleEdgeIndex(body: ParametricBodyNode): number {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const index = edges.findIndex((edge) => edge.curve.basisCurve.curveType === "circle");
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}

function addFillet(body: ParametricBodyNode, index: number) {
    const edge = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])[index];
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id: "f1", type: "fillet", radius: 1, edges: [captureEdgeRef(edge, body.edgeIdAt(index), false)] },
    ]);
}

test("a fillet on a closed sweep's seam is refused, not left to abort the kernel", () => {
    const body = cylinder();

    // Before the guard this call raised inside OCCT, and the release build's disabled
    // exception catching turned that into an abort that took the whole wasm module down with
    // it — every later operation in the session failing. It must come back as an error row.
    addFillet(body, seamEdgeIndex(body));

    expect(body.featureItems()[1].error).toContain("same face on both sides");
    // The chain survives: the body still holds the revolve alone, and says so.
    expect(body.shape.isOk).toBe(true);
});

test("the same body's ordinary edges still fillet", () => {
    const body = cylinder();

    addFillet(body, circleEdgeIndex(body));

    expect(body.featureItems()[1].error).toBeUndefined();
    expect(body.shape.isOk).toBe(true);
});
