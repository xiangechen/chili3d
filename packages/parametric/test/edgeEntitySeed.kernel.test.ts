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

/**
 * Same geometry with the entity list reversed: the connected group is seeded from
 * another end, so the profile wire chains (and enumerates) in a different order
 * while every entity keeps its id and geometry.
 */
function squareReversed(size: number): SketchData {
    return { entities: [...square(size).entities].reverse(), constraints: [] };
}

/** A 10×10 square with a divider T-joining the bottom and top edges (the kernel path). */
function squareWithDivider(dividerX: number): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [0, 0, 10, 0] },
            { id: 2, type: "line", params: [10, 0, 10, 10] },
            { id: 3, type: "line", params: [10, 10, 0, 10] },
            { id: 4, type: "line", params: [0, 10, 0, 0] },
            { id: 5, type: "line", params: [dividerX, 0, dividerX, 10] },
        ],
        constraints: [],
    };
}

function setup(data: SketchData) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 10 }],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { doc, sketch, body };
}

function edgesOf(body: ParametricBodyNode): IEdge[] {
    return body.shape.unchecked()?.findSubShapes(ShapeTypes.edge) as IEdge[];
}

/** Geometry of every sketch-scoped edge id: id → its edges' endpoint pairs (orientation-insensitive). */
function edgeGeometryBySeedId(body: ParametricBodyNode): Map<string, number[][][]> {
    const result = new Map<string, number[][][]>();
    for (const [index, edge] of edgesOf(body).entries()) {
        const id = body.edgeIdAt(index);
        if (!id?.startsWith("sketch:")) continue;
        const points = [edge.startPoint(), edge.endPoint()].map((p) => [p.x, p.y, p.z]);
        points.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
        const list = result.get(id) ?? [];
        list.push(points);
        result.set(id, list);
    }
    for (const list of result.values()) {
        list.sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1] || a[0][2] - b[0][2]);
    }
    return result;
}

describe("sketch entity edge seeds (real kernel)", () => {
    test("swept edge seeds come from the generating sketch entity", () => {
        const { body } = setup(square(10));
        const ids = [...edgeGeometryBySeedId(body).keys()];
        // The four bottom edges keep their profile-edge seeds (top and vertical
        // edges are feature-scoped); each seed names its entity, not a wire position.
        expect(ids).toHaveLength(4);
        for (const id of ids) expect(id).toMatch(/^sketch:.+:e1\.2\.3\.4:ent[1-4]$/);
        expect(new Set(ids.map((id) => id.split(":ent")[1])).size).toBe(4);
    });

    test("reordering the sketch entities keeps every seed on its edge", () => {
        const { sketch, body } = setup(square(10));
        const before = edgeGeometryBySeedId(body);

        sketch.setDataEmitShapeChanged(squareReversed(10));
        expect(body.shape.isOk).toBe(true);

        // The wire enumerates in a different order; positional `:e<index>` seeds
        // would realign onto other edges, entity-attributed seeds stay put.
        expect(edgeGeometryBySeedId(body)).toEqual(before);
    });

    test("a start offset keeps the entity-derived edge seeds", () => {
        // The sweep translates the profile face for a start offset; the translated
        // copy must carry the entity attribution over, or every bottom edge seed
        // would demote to a positional ordinal.
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square(10) });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            features: [{ id: "f1", type: "extrude", sketchId: sketch.id, depth: 10, startOffset: 5 }],
        });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);

        const ids = [...edgeGeometryBySeedId(body).keys()];
        expect(ids).toHaveLength(4);
        for (const id of ids) expect(id).toMatch(/^sketch:.+:e1\.2\.3\.4:ent[1-4]$/);
        expect(new Set(ids.map((id) => id.split(":ent")[1])).size).toBe(4);
    });

    test("a T-junction sketch attributes split pieces to their source entity", () => {
        const { sketch, body } = setup(squareWithDivider(5));
        const before = edgeGeometryBySeedId(body);
        // The outer boundary's pieces are attributed to their source entities; the
        // divider's own pieces are interior to the fused bottom face and vanish.
        expect([...before.keys()].map((id) => id.split(":ent")[1]).sort()).toEqual(["1", "2", "3", "4"]);
        // Entity 1's two pieces fused back into one edge carrying the entity's seed.
        const ent1 = [...before.keys()].find((id) => id.endsWith(":ent1"));
        if (!ent1) throw new Error("ent1 seed missing");
        expect(before.get(ent1)).toHaveLength(1);

        sketch.setDataEmitShapeChanged(squareWithDivider(7));
        expect(body.shape.isOk).toBe(true);

        // Moving the divider re-cuts the regions; attribution keeps every id on its
        // entity (the fused outer geometry is unchanged, so the whole map is).
        expect(edgeGeometryBySeedId(body)).toEqual(before);
    });
});
