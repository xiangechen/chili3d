// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
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

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

/** A 40×40×10 box on the XY plane. */
function boxBody(doc: TestDocument, depth: number): ParametricBodyNode {
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 40, 40) });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth }],
    });
    doc.modelManager.addNode(body);
    return body;
}

/** A square tool body whose corners sit at `x`/`y` half-extent — a square bore. */
function squareTool(doc: TestDocument, half: number, depth: number): ParametricBodyNode {
    const sketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        data: rect(20 - half, 20 - half, 20 + half, 20 + half),
    });
    doc.modelManager.addNode(sketch);
    const tool = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e2", type: "extrude", sketchId: sketch.id, depth }],
    });
    doc.modelManager.addNode(tool);
    return tool;
}

/** Edge ids of the body the id names — the four curves a bore leaves in the top face. */
function boreEdgeIds(body: ParametricBodyNode): string[] {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    return edges.map((_, index) => body.edgeIdAt(index) ?? "?");
}

describe("boolean-born edge ids (real kernel)", () => {
    test("the curves a cut carves are named by the faces they join", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const host = boxBody(doc, 10);
        const tool = squareTool(doc, 10, 20);
        host.setFeaturesEmitShapeChanged([
            ...host.features,
            { id: "b1", type: "boolean", operation: "cut", toolIds: [tool.id], consumeTools: false },
        ]);
        expect(host.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

        const ids = boreEdgeIds(host);
        // Every bore curve is named by the "face pair" it joins: the wall it cuts against the
        // top face. A positional id would name the output index instead — and realign onto a
        // neighbour the moment the enumeration rotates (see `bornEdgeIdMap`).
        const born = ids.filter((id) => id.includes("&"));
        expect(born).toHaveLength(4);
        expect(new Set(born).size).toBe(4);
        for (const id of born) {
            // A conjunction of exactly two stable ids, neither of them positional
            // (host-space faces keep their seed, tool-space ones are tool-scoped).
            expect(id.split("&")).toHaveLength(2);
            for (const part of id.split("&")) expect(part).not.toContain("@");
        }
    });

    test("the same cut over a different bore keeps its own curves' ids", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const host = boxBody(doc, 10);
        const tool = squareTool(doc, 10, 20);
        host.setFeaturesEmitShapeChanged([
            ...host.features,
            { id: "b1", type: "boolean", operation: "cut", toolIds: [tool.id], consumeTools: false },
        ]);
        const before = boreEdgeIds(host).filter((id) => id.includes("&"));

        // Widening the bore's own sketch re-cuts the curves; they are still the same four
        // edges of the same wall-vs-top pair, so the ids hold.
        const toolSketch = doc.modelManager.findNodes((n) => n instanceof SketchNode).at(-1) as SketchNode;
        toolSketch.setDataEmitShapeChanged(rect(5, 5, 35, 35));
        expect(host.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        expect(boreEdgeIds(host).filter((id) => id.includes("&"))).toEqual(before);
    });
});
