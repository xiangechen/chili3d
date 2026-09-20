// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Regression suite for the id a fillet gives the boundary it carves when it rounds a CLOSED edge.
 *
 *   1. extrude a circle → a cylinder (lateral face + bottom + top, and the closed sweep's seam);
 *   2. fillet the top circle → the rim is rounded: the lateral face is trimmed where the round
 *      stops (a new circle), the top face shrinks, and the round itself is a new face between.
 *
 * The reported-class failure: the new boundary circle took the id of the cylinder's BOTTOM
 * circle 38mm away. `bornEdgeIdMap` named a born edge by the faces it borders, and a sub-shape
 * with only ONE named neighbour degenerated into that neighbour's own id — here the lateral
 * face's seed, which is exactly what the bottom circle carries. The two then read as pieces of
 * ONE split edge, so `idsOverlap` matched both and a fillet ref on the bottom circle could widen
 * onto the rim (see `edgeMatcher`'s whole-span adoption for a ref that is not `splitPiece`).
 *
 * The tests pin, in order:
 * - a fillet's new boundary does not borrow a distant edge's id (the naming rule, directly);
 * - and the consequence: a ref on the bottom circle keeps resolving to that circle alone after
 *   an upstream edit staled its fingerprint.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { matchEdgeIndexes } from "../src/features/edgeMatcher";
import { captureEdgeRef, type EdgeRef } from "../src/features/edgeRef";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
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

const round = (x: number) => Math.round(x * 1e6) / 1e6;

const edgesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];

/** A cylinder of radius `radius`, 40 tall, extruded from a circle sketch. */
function cylinder(doc: TestDocument, radius: number): { body: ParametricBodyNode; sketch: SketchNode } {
    const sketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        data: { entities: [{ id: 1, type: "circle", params: [20, 20, radius] }], constraints: [] },
    });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 40,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    return { body, sketch };
}

/**
 * The body's edge lying on the plane `z`, plus its index. Both endpoints must sit on it, which
 * picks the closed circle and excludes the closed sweep's seam (the same z at one end only).
 */
function edgeAtZ(body: ParametricBodyNode, z: number): { edge: IEdge; index: number } {
    const index = edgesOf(body).findIndex(
        (edge) => round(edge.startPoint().z) === z && round(edge.endPoint().z) === z,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    return { edge: edgesOf(body)[index], index };
}

/** Rounds the body's edge at `z`, captured the way the fillet command captures it. */
function filletAtZ(body: ParametricBodyNode, z: number, radius: number, id: string): EdgeRef {
    const { edge, index } = edgeAtZ(body, z);
    const edgeId = body.edgeIdAt(index);
    const ref = captureEdgeRef(edge, edgeId, body.edgeIdIsShared(edgeId));
    body.setFeaturesEmitShapeChanged([...body.features, { id, type: "fillet", radius, edges: [ref] }]);
    return ref;
}

function newDoc(): TestDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

/** Every id shared by several edges, with how far apart those edges sit (mm). */
function sharedIdSpreads(body: ParametricBodyNode): { id: string; spread: number }[] {
    const edges = edgesOf(body);
    const byId = new Map<string, number[]>();
    edges.forEach((_, index) => {
        const id = body.edgeIdAt(index);
        if (id !== undefined) byId.set(id, [...(byId.get(id) ?? []), index]);
    });
    const centreOf = (edge: IEdge) => {
        const box = edge.boundingBox();
        return [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2];
    };
    const out: { id: string; spread: number }[] = [];
    for (const [id, indexes] of byId) {
        if (indexes.length < 2) continue;
        const centres = indexes.map((i) => centreOf(edges[i]));
        let spread = 0;
        for (const a of centres) {
            for (const b of centres) {
                spread = Math.max(spread, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
            }
        }
        out.push({ id, spread: round(spread) });
    }
    return out;
}

test("a fillet on a closed edge does not name its boundary after a distant edge", () => {
    const doc = newDoc();
    const { body } = cylinder(doc, 10);
    filletAtZ(body, 40, 2, "f1");
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

    // The rim round is 38mm above the cylinder's bottom circle; sharing an id across that gap
    // would make the two read as pieces of one split edge.
    expect(sharedIdSpreads(body).filter((x) => x.spread > 5)).toEqual([]);
});

test("the bottom circle's id is claimed by that circle alone after the rim is rounded", () => {
    const doc = newDoc();
    const { body, sketch } = cylinder(doc, 10);
    // Picked while the cylinder is whole: the id is unique, so the fillet command does NOT stamp
    // the ref `splitPiece` and nothing stops it from adopting a whole span later — the id channel
    // has to stay unambiguous on its own (see `singleExactHit`).
    const bottomIndex = edgeAtZ(body, 0).index;
    const bottomId = body.edgeIdAt(bottomIndex);
    expect(typeof bottomId).toBe("string");
    expect(body.edgeIdIsShared(bottomId)).toBe(false);
    const ref: EdgeRef = captureEdgeRef(edgesOf(body)[bottomIndex], bottomId, false);

    filletAtZ(body, 40, 2, "f1");
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);

    // The rim round used to hand the lateral face's seed to its own new boundary circle — the
    // very id the bottom circle carries — so the id resolved to two edges 38mm apart. Indexes
    // shift when the round adds edges, so the claim is judged by geometry.
    const claimed = body.edgeIndexesOfId(bottomId!);
    expect(claimed).toHaveLength(1);
    expect(round(edgesOf(body)[claimed[0]].startPoint().z)).toBe(0);

    // An edit keeps it that way, and the stored ref still resolves to the one circle it names.
    sketch.setDataEmitShapeChanged({
        entities: [{ id: 1, type: "circle", params: [20, 20, 12] }],
        constraints: [],
    });
    expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
    expect(body.edgeIndexesOfId(bottomId!)).toHaveLength(1);
    const matched = matchEdgeIndexes(body.shape.unchecked()!, [ref]);
    expect(matched.isOk).toBe(true);
    if (matched.isOk) expect(round(edgesOf(body)[matched.value[0]].startPoint().z)).toBe(0);
});
