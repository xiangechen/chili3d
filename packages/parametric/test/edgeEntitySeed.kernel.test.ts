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

/**
 * The content part of a sweep seed id — everything after `<sketch>:<nodeId>:<profileSeed>`
 * (`ent3`, `ent3:top`, `v2.3`, …), so the assertions do not depend on the node id.
 */
function seedContent(id: string): string {
    const match = /^sketch:[^:]+:[^:]+:(.+)$/.exec(id);
    if (match === null) throw new Error(`not a sweep seed id: ${id}`);
    return match[1];
}

/** The same, for an id that may be a compound of several regions' seeds. */
function shortId(id: string): string {
    return id.replace(/sketch:[^:]+:/g, "");
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
        // Every edge of the prism is content-derived, and none is left positional: the
        // bottom edges keep their profile-edge seed, their swept images add `:top`, and
        // the verticals carry the corner they stand on (`v<entityA>.<entityB>`, sorted).
        expect(ids.map(seedContent).sort()).toEqual(
            [
                "ent1",
                "ent2",
                "ent3",
                "ent4",
                "ent1:top",
                "ent2:top",
                "ent3:top",
                "ent4:top",
                "v1.2",
                "v2.3",
                "v3.4",
                "v1.4",
            ].sort(),
        );
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

        // Every edge is named by content — a positional id here would be the offset
        // enumeration's, not the geometry's.
        expect([...edgeGeometryBySeedId(body).keys()].map(seedContent)).toContain("ent1:top");
        expect([...edgeGeometryBySeedId(body).keys()].map(seedContent)).toContain("v1.2");
        expect(new Set([...edgeGeometryBySeedId(body).keys()].map(seedContent)).size).toBe(12);
    });

    test("a T-junction sketch attributes split pieces to their source entity", () => {
        const { sketch, body } = setup(squareWithDivider(5));
        const before = edgeGeometryBySeedId(body);
        const ids = [...before.keys()].map(shortId);
        // Nothing is left positional: every edge is named by the entities and corners it
        // came from, and the divider — interior once the two regions fuse — names nothing.
        expect(ids.filter((id) => id.includes("@"))).toEqual([]);
        expect(ids.filter((id) => id.includes(":ent5"))).toEqual([]);
        // The four edges the fuse MERGED — each long side's bottom and its swept image —
        // carry BOTH regions' ids, the same entity on either side of the compound: a ref
        // captured on one half keeps intersecting the whole edge.
        const merged = ids.filter((id) => id.includes("|"));
        expect(merged).toHaveLength(4);
        for (const id of merged) {
            const [a, b] = id.split("|");
            expect(a.split(":").at(-1)).toBe(b.split(":").at(-1));
        }
        // The two untouched sides and the four verticals name a single entity each.
        expect(ids.filter((id) => !id.includes("|"))).toHaveLength(8);

        sketch.setDataEmitShapeChanged(squareWithDivider(7));
        expect(body.shape.isOk).toBe(true);

        // Moving the divider re-cuts the regions; attribution keeps every id on its
        // entity (the fused outer geometry is unchanged, so the whole map is).
        expect(edgeGeometryBySeedId(body)).toEqual(before);
    });
});
