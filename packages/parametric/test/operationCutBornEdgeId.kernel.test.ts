// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
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
 * A 40×40×10 box on the XY plane, with the sketch of a second extrude that CUTS it — the
 * operation path, where the cutting prism is a swept tool rather than a separate body.
 */
function cutBody(doc: TestDocument, bore: SketchData) {
    const sketch = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: rect(0, 0, 40, 40) });
    doc.modelManager.addNode(sketch);
    const cutting = new SketchNode({ document: doc, id: "sk2", plane: Plane.XY, data: bore });
    doc.modelManager.addNode(cutting);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            { id: "e1", type: "extrude", sketchId: sketch.id, depth: 10 },
            { id: "e2", type: "extrude", sketchId: cutting.id, depth: 20, operation: "cut" },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { body, cutting };
}

/** The ids of everything the body's shape carries, a "?" where nothing names it. */
function edgeIds(body: ParametricBodyNode): string[] {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    return edges.map((_, index) => body.edgeIdAt(index) ?? "?");
}

describe("cut-operation born edge ids (real kernel)", () => {
    test("the curves a cut operation carves are named by the faces they join", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const { body } = cutBody(doc, rect(15, 15, 25, 25));
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

        // The same naming a boolean FEATURE gives its carved curves (see
        // `booleanBornEdgeId.kernel.test.ts`): the curves a join/cut carves derive from nothing
        // in either operand, so they are named by the two faces they join. Without it they had
        // no id at all — measured, four of the body's twenty-four edges.
        const born = edgeIds(body).filter((id) => id.includes("&"));
        expect(born).toHaveLength(4);
        expect(new Set(born).size).toBe(4);
        for (const id of born) {
            // A conjunction of exactly two stable ids, both sketch-scoped.
            expect(id.split("&")).toHaveLength(2);
            for (const part of id.split("&")) expect(part).toContain("sketch:");
        }
        // Nothing is left unnamed.
        expect(edgeIds(body).filter((id) => id === "?")).toEqual([]);
    });

    test("the same cut over a wider bore keeps its own curves' ids", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const { body, cutting } = cutBody(doc, rect(15, 15, 25, 25));
        const before = edgeIds(body).filter((id) => id.includes("&"));
        expect(before).toHaveLength(4);

        // Widening the bore's sketch re-cuts the curves: they are still the same four edges of
        // the same wall-vs-face pair, so the ids hold — which is what naming them buys over a
        // name tied to their position in the rebuilt shape's enumeration.
        cutting.setDataEmitShapeChanged(rect(10, 10, 30, 30));
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        expect(edgeIds(body).filter((id) => id.includes("&"))).toEqual(before);
    });
});
