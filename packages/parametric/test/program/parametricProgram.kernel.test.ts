// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The program engine drives the same API the interactive commands do, so these assert the
 * three invariants the rest of the parametric suite is built on: no feature row reports an
 * error, an upstream edit carries the whole chain, and undoing it leaves no residue. On top
 * of that they pin the engine's own contract — a failed program throws so the caller's
 * transaction rolls the entire program back, leaving no half-built body behind.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FolderNode, type IEdge, type IFace, ShapeTypes, Transaction } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { type ParametricOp, runParametricProgram } from "../../src/program/parametricProgram";
import { SketchNode } from "../../src/sketch/sketchNode";
import "../sketch/setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

function newDoc(): TestDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

/** Perimeter lines of a rectangle, closing back onto the first point. */
function rect(x0: number, y0: number, x1: number, y1: number) {
    return [
        { type: "line" as const, params: [x0, y0, x1, y0] },
        { type: "line" as const, params: [x1, y0, x1, y1] },
        { type: "line" as const, params: [x1, y1, x0, y1] },
        { type: "line" as const, params: [x0, y1, x0, y0] },
    ];
}

/** Runs a program inside a transaction — the way the AI tool drives it. */
function run(doc: TestDocument, ops: ParametricOp[]): ReturnType<typeof runParametricProgram> {
    let result: ReturnType<typeof runParametricProgram> | undefined;
    Transaction.execute(doc, "test program", () => {
        result = runParametricProgram(doc, ops);
    });
    return result!;
}

/** Runs a program expected to fail; returns the thrown message after the rollback. */
function runExpectingFailure(doc: TestDocument, ops: ParametricOp[]): string {
    let message = "";
    try {
        Transaction.execute(doc, "test program", () => {
            runParametricProgram(doc, ops);
        });
    } catch (err) {
        message = (err as Error).message;
    }
    expect(message).toMatch(/failed/);
    return message;
}

const bodyOf = (doc: TestDocument, id: string) =>
    doc.modelManager.findNodes((n) => n.id === id)[0] as ParametricBodyNode;

/** The body a given op produced — `created` also lists the sketches, so look it up by op id. */
function createdBody(
    doc: TestDocument,
    result: { created: { id: string; nodeId: string }[] },
    id: string,
): ParametricBodyNode {
    const entry = result.created.find((created) => created.id === id);
    expect(entry).toBeDefined();
    return bodyOf(doc, entry!.nodeId);
}

/** Every top-level node id in the document, for the "nothing was left behind" assertions. */
const nodeIds = (doc: TestDocument) => doc.modelManager.findNodes(() => true).map((n) => n.id);

const round = (x: number) => Math.round(x * 1e6) / 1e6;

function extent(body: ParametricBodyNode): number[] {
    const box = body.shape.unchecked()!.boundingBox();
    return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(round);
}

function expectClean(...bodies: ParametricBodyNode[]): void {
    const broken = bodies
        .flatMap((body) => body.featureItems())
        .filter((item) => item.error !== undefined)
        .map((item) => `${item.id}: ${item.error}`);
    expect(broken).toEqual([]);
}

const plate = (depth: number): ParametricOp[] => [
    { op: "sketch", id: "s1", plane: "XY", entities: rect(0, 0, 40, 30) },
    { op: "extrude", id: "b1", sketch: "s1", depth },
];

describe("sketch and extrude", () => {
    test("a sketch plus an extrude produces a clean body with the expected extent", () => {
        const doc = newDoc();
        const result = run(doc, [
            { op: "sketch", id: "s1", plane: "XY", entities: rect(0, 0, 40, 30) },
            {
                op: "extrude",
                id: "b1",
                sketch: "s1",
                depth: 20,
                name: "Plate",
            },
        ]);

        const body = createdBody(doc, result, "b1");
        expectClean(body);
        expect(body.featureItems().map((item) => item.id)).toHaveLength(1);
        expect(extent(body)).toEqual([0, 0, 0, 40, 30, 20]);
        // The sketch is consumed into the feature list — hidden, but still present.
        const sketch = doc.modelManager.findNodes((n) => n instanceof SketchNode)[0];
        expect(sketch).toBeDefined();
        expect(sketch.visible).toBe(false);
    });

    test("an unclosed profile is rejected and the transaction leaves no node behind", () => {
        const doc = newDoc();
        const message = runExpectingFailure(doc, [
            {
                op: "sketch",
                id: "s1",
                plane: "XY",
                entities: [
                    { type: "line", params: [0, 0, 40, 0] },
                    { type: "line", params: [40, 0, 40, 30] },
                    { type: "line", params: [40, 30, 0, 30] },
                ],
            },
            { op: "extrude", id: "b1", sketch: "s1", depth: 20 },
        ]);

        expect(message).toContain("extrude");
        expect(nodeIds(doc)).toEqual([]);
    });

    test("a sketch can be built on a planar face of an existing body", () => {
        const doc = newDoc();
        const first = run(doc, plate(20));
        const body = createdBody(doc, first, "b1");
        const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const topIndex = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
        expect(topIndex).toBeGreaterThanOrEqual(0);

        const second = run(doc, [
            {
                op: "sketch",
                id: "s2",
                plane: { nodeId: body.id, faceIndex: topIndex },
                entities: rect(10, 10, 20, 20),
            },
            { op: "extrude", id: "b2", sketch: "s2", depth: 10, body: body.id, operation: "fuse" },
        ]);

        expectClean(body);
        // The boss rides on the plate's top face: 20 + 10 tall, still 40 x 30 across.
        expect(extent(body)).toEqual([0, 0, 0, 40, 30, 30]);
        // Only the sketch was created — the extrude joined the existing body.
        expect(second.created.map((created) => created.id)).toEqual(["s2"]);
    });
});

describe("feature list editing", () => {
    test("a depth edit carries the geometry and editing back restores it exactly", () => {
        const doc = newDoc();
        const result = run(doc, plate(20));
        const body = createdBody(doc, result, "b1");
        const featureId = body.featureItems()[0].id;
        expect(extent(body)).toEqual([0, 0, 0, 40, 30, 20]);

        run(doc, [
            { op: "editFeature", body: body.id, featureId, action: "setParameter", key: "depth", value: 35 },
        ]);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 30, 35]);

        run(doc, [
            { op: "editFeature", body: body.id, featureId, action: "setParameter", key: "depth", value: 20 },
        ]);
        expectClean(body);
        expect(extent(body)).toEqual([0, 0, 0, 40, 30, 20]);
    });

    test("the result envelope survives JSON serialization", () => {
        const doc = newDoc();
        const result = run(doc, [...plate(20), { op: "features", id: "read", body: "b1" }]);

        // featureItems() carries live nodes in `references` (the sketch an extrude holds),
        // and a node owns its parent and document. This is the whole reason the engine
        // projects the rows: returning them raw made the caller's JSON.stringify throw.
        // Wording differs by engine ("Converting circular structure" in node,
        // "cannot serialize cyclic structures" in the browser) — match either.
        expect(() => JSON.stringify(createdBody(doc, result, "b1").featureItems())).toThrow(
            /circular|cyclic/i,
        );

        const json = JSON.stringify(result);
        const items = JSON.parse(json).results.read as { references: { nodeId: string }[] }[];
        expect(items[0].references[0].nodeId).toBeTruthy();
    });

    test("an op that edits a body registers its own id as another name for that body", () => {
        const doc = newDoc();
        const first = run(doc, plate(20));
        const body = createdBody(doc, first, "b1");

        const second = run(doc, [
            { op: "sketch", id: "s2", plane: "XY", entities: rect(10, 10, 20, 20) },
            { op: "extrude", id: "e2", sketch: "s2", depth: 10, body: "b1", operation: "fuse" },
            // "e2" named an edit, but it resolves to the body it edited.
            { op: "features", id: "read", body: "e2" },
        ]);

        expectClean(body);
        const items = (second.results as { read: unknown[] }).read;
        expect(items).toHaveLength(2);
        expect(second.created.map((created) => created.id)).toEqual(["s2"]);
    });

    test("the features op reports the list, and remove drops the feature", () => {
        const doc = newDoc();
        const result = run(doc, plate(20));
        const body = createdBody(doc, result, "b1");

        const read = run(doc, [{ op: "features", id: "f", body: body.id }]);
        const items = (read.results as { f: { id: string; parameters: { key: string }[] }[] }).f;
        expect(items).toHaveLength(1);
        expect(items[0].parameters.map((p) => p.key)).toContain("depth");

        run(doc, [{ op: "editFeature", body: body.id, featureId: items[0].id, action: "remove" }]);
        expect(body.featureItems()).toHaveLength(0);
    });

    test("a feature that cannot rebuild is reported and nothing is committed", () => {
        const doc = newDoc();
        const result = run(doc, plate(20));
        const body = createdBody(doc, result, "b1");
        const featureId = body.featureItems()[0].id;
        const before = extent(body);

        const message = runExpectingFailure(doc, [
            { op: "editFeature", body: body.id, featureId, action: "setParameter", key: "depth", value: 0 },
        ]);

        expect(message).toContain("extrude");
        expect(extent(body)).toEqual(before);
    });
});

describe("fillet and boolean", () => {
    test("a fillet takes edge indexes and reports an out-of-range index", () => {
        const doc = newDoc();
        const result = run(doc, plate(20));
        const body = createdBody(doc, result, "b1");

        const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
        expect(edges.length).toBeGreaterThan(0);
        const message = runExpectingFailure(doc, [
            { op: "fillet", id: "f1", body: body.id, edgeIndexes: [edges.length], radius: 2 },
        ]);
        expect(message).toContain("out of range");

        // A top edge (z = 20) is fillet-able; the extent shrinks at the corners only.
        const topIndex = edges.findIndex((edge) => edge.boundingBox().min.z > 19.9);
        expect(topIndex).toBeGreaterThanOrEqual(0);
        run(doc, [{ op: "fillet", id: "f1", body: body.id, edgeIndexes: [topIndex], radius: 4 }]);
        expectClean(body);
        expect(body.featureItems()).toHaveLength(2);
    });

    test("a boolean adopts its tool nodes as hidden children instead of deleting them", () => {
        const doc = newDoc();
        const result = run(doc, [
            ...plate(20),
            { op: "sketch", id: "s2", plane: "XY", entities: rect(10, 10, 20, 20) },
            { op: "extrude", id: "b2", sketch: "s2", depth: 40 },
            { op: "boolean", id: "c1", body: "b1", operation: "cut", tools: ["b2"] },
        ]);

        const body = createdBody(doc, result, "b1");
        const tool = createdBody(doc, result, "b2");
        expectClean(body);
        expect(result.consumed.map((c) => c.nodeId)).toEqual([tool.id]);
        // Hidden by re-parenting, not by a visibility flag — the body's child list renders nothing.
        expect(body.firstChild?.id).toBe(tool.id);
        expect(tool.parent?.id).toBe(body.id);
        // The outer extent is unchanged by the pocket; the tool still exists as a node.
        expect(extent(body)).toEqual([0, 0, 0, 40, 30, 20]);
        expect(nodeIds(doc)).toContain(tool.id);
    });
});

describe("constraints", () => {
    test("a constrained sketch is solved before it is stored", () => {
        const doc = newDoc();
        run(doc, [
            {
                op: "sketch",
                id: "s1",
                plane: "XY",
                entities: [{ type: "line", params: [0, 0, 10, 0] }],
                // The drawn line is 10 long; the dimension has to move it to 60.
                constraints: [
                    {
                        kind: "P2PDistance",
                        refs: [
                            { entity: 1, point: 0 },
                            { entity: 1, point: 1 },
                        ],
                        datum: 60,
                    },
                ],
            },
        ]);

        const sketch = doc.modelManager.findNodes((n) => n instanceof SketchNode)[0] as SketchNode;
        const [x1, y1, x2, y2] = sketch.data.entities[0].params;
        expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(60, 1);
        expect(sketch.data.constraints).toHaveLength(1);
    });

    test("an unknown constraint kind names the valid ones", () => {
        const doc = newDoc();
        const message = runExpectingFailure(doc, [
            {
                op: "sketch",
                id: "s1",
                plane: "XY",
                entities: rect(0, 0, 40, 30),
                constraints: [{ kind: "NotAKind", refs: [{ entity: 1, point: 0 }] }],
            },
        ]);
        expect(message).toContain("unknown constraint kind");
        expect(message).toContain("P2PCoincident");
    });
});

describe("model tree icons", () => {
    test("a sketch reads apart from the solid it feeds", () => {
        const doc = newDoc();
        const result = run(doc, plate(20));
        const body = createdBody(doc, result, "b1");
        const sketch = doc.modelManager.findNodes((n) => n instanceof SketchNode)[0] as SketchNode;

        expect(sketch.icon).toBe("icon-sketchEdit");
        expect(body.icon).toBe("icon-box");
        expect(new FolderNode({ document: doc, name: "folder" }).icon).toBe("icon-folder");
        // The point of the contract: a sketch must not read as another solid.
        expect(sketch.icon).not.toBe(body.icon);
    });
});

describe("undo", () => {
    test("one program is one undo step", () => {
        const doc = newDoc();
        run(doc, plate(20));
        expect(nodeIds(doc)).toHaveLength(2);

        doc.history.undo();
        expect(nodeIds(doc)).toEqual([]);

        doc.history.redo();
        expect(nodeIds(doc)).toHaveLength(2);
        expectClean(
            doc.modelManager.findNodes((n) => n instanceof ParametricBodyNode)[0] as ParametricBodyNode,
        );
    });
});
