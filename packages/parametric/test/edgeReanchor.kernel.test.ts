// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef, type EdgeRef } from "../src/features/edgeRef";
import type { FilletFeatureData } from "../src/features/feature";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";

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

/** An extruded square plus one captured edge of the (pre-fillet) box. */
function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square(10) });
    doc.modelManager.addNode(sketch);
    const extrude = { id: "f1", type: "extrude", sketchId: sketch.id, depth: 10 } as const;
    const body = new ParametricBodyNode({ document: doc, features: [extrude] });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    const edge = (body.shape.unchecked()?.findSubShapes(ShapeTypes.edge) as IEdge[])[0];
    return { doc, sketch, body, extrude, edge };
}

function appendFillet(body: ParametricBodyNode, extrude: unknown, edges: EdgeRef[]): void {
    body.setFeaturesEmitShapeChanged([
        extrude as never,
        { id: "f2", type: "fillet", radius: 1, edges } as never,
    ]);
}

function filletFeature(body: ParametricBodyNode): FilletFeatureData {
    return body.features[1] as FilletFeatureData;
}

describe("edge-ref re-anchoring (real kernel)", () => {
    test("a legacy id-less ref gains the matched edge's id and keeps it from then on", () => {
        const { sketch, body, extrude, edge } = setup();
        appendFillet(body, extrude, [captureEdgeRef(edge)]);
        expect(body.shape.isOk).toBe(true);

        // The re-anchored id is one of the pre-fillet chain's ids (timelineStateAt
        // exposes the state entering the fillet).
        const anchored = filletFeature(body).edges[0].edgeId;
        expect(anchored).toBeDefined();
        expect(body.timelineStateAt(1)?.edgeIds).toContain(anchored);
        const anchoredJson = body.featuresJson;

        // A rigid move resolves by id again — the anchor passes through unchanged.
        sketch.setDataEmitShapeChanged(square(20));
        expect(body.shape.isOk).toBe(true);
        expect(body.featureItems()[1].error).toBeUndefined();
        expect(body.featuresJson).toBe(anchoredJson);
    });

    test("a dead id is replaced by the id of the edge the fingerprint recovered", () => {
        const { sketch, body, extrude, edge } = setup();
        const stale: EdgeRef = { ...captureEdgeRef(edge), edgeId: "dead:9" };
        appendFillet(body, extrude, [stale]);
        expect(body.shape.isOk).toBe(true);
        expect(body.featureItems()[1].error).toBeUndefined();

        const anchored = filletFeature(body).edges[0];
        expect(anchored.edgeId).not.toBe("dead:9");
        expect(body.timelineStateAt(1)?.edgeIds).toContain(anchored.edgeId);

        // The next edit resolves through the fresh id, not the fingerprint.
        sketch.setDataEmitShapeChanged(square(20));
        expect(body.shape.isOk).toBe(true);
        expect(body.featureItems()[1].error).toBeUndefined();
    });
});
