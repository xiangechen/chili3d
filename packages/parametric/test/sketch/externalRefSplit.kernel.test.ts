// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// End-to-end: a sketch references a body edge (profile role), then a boolean
// reworks that edge. When the edge is split into pieces whose union still covers
// it, the ref survives via same-curve span coverage; when the middle is consumed,
// the ref goes dangling but the sketch profile degrades to the frozen snapshot
// instead of failing with "Sketch profile is not closed".

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { sketchProfiles } from "../../src/features/profileBuilder";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { captureExternalRef } from "../../src/sketch/externalRef";
import type { SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import "./setup";

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

/** The front-bottom edge of the box: both endpoints on y=0 and z=0. */
function bottomFrontEdgeIndex(edges: IEdge[]): number {
    return edges.findIndex((edge) =>
        [edge.startPoint(), edge.endPoint()].every((p) => Math.abs(p.y) < 1e-9 && Math.abs(p.z) < 1e-9),
    );
}

/** The z=0 face's plane: normal -Z, u along +X, v along -Y. */
function bottomPlane(): Plane {
    return new Plane({
        origin: new XYZ({ x: 0, y: 0, z: 0 }),
        normal: new XYZ({ x: 0, y: 0, z: -1 }),
        xvec: new XYZ({ x: 1, y: 0, z: 0 }),
    });
}

/** Pieces of the front-bottom edge surviving on the body's current shape. */
function bottomEdgePieces(body: ParametricBodyNode): IEdge[] {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    return edges.filter((edge) =>
        [edge.startPoint(), edge.endPoint()].every(
            (p) => Math.abs(p.y) < 1e-9 && Math.abs(p.z) < 1e-9 && p.x >= -1e-9 && p.x <= 10 + 1e-9,
        ),
    );
}

/**
 * A 10³ box from sketch1 and a second sketch on the y=0 side face holding a
 * pinned profile-role ref to the front-bottom edge (0,0,0)-(10,0,0); the three
 * drawn lines T-join that edge, so the rectangle only closes through the ref.
 */
function setupBoxWithReferencedSketch() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: square(10) });
    doc.modelManager.addNode(sketch1);
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: sketch1.id, depth: 10 }],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);

    // Capture the front-bottom edge (0,0,0)-(10,0,0) into a sketch on the y=0 side
    // face (normal -Y, v along +Z).
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const targetIndex = bottomFrontEdgeIndex(edges);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    const sidePlane = new Plane({
        origin: new XYZ({ x: 0, y: 0, z: 0 }),
        normal: new XYZ({ x: 0, y: -1, z: 0 }),
        xvec: new XYZ({ x: 1, y: 0, z: 0 }),
    });
    const ref = {
        ...captureExternalRef(
            -100,
            body.id,
            sidePlane,
            edges[targetIndex],
            body.edgeIdAt(targetIndex),
            "profile",
        )!,
        // no constraint references the ref — pin so role derivation keeps it a profile
        pinned: true,
    };
    expect(ref.snapshot).toEqual([0, 0, 10, 0]);

    // The sketch holding the reference (bottom side of a rectangle on the edge).
    const sketch2 = new SketchNode({
        document: doc,
        plane: sidePlane,
        data: {
            entities: [
                { id: 1, type: "line", params: [3, 0, 3, 5] },
                { id: 2, type: "line", params: [3, 5, 7, 5] },
                { id: 3, type: "line", params: [7, 5, 7, 0] },
            ],
            constraints: [],
            externalRefs: [ref],
        },
    });
    doc.modelManager.addNode(sketch2);
    // lazy first generation installs the source-node watch
    expect(sketch2.shape.isOk).toBe(true);
    return { doc, sketch1, body, sketch2 };
}

test("a boolean splitting the referenced edge into covering pieces keeps the external ref alive", () => {
    const { body, sketch1, sketch2 } = setupBoxWithReferencedSketch();

    // A hole cut into the bottom face, tangent to the referenced edge at (5,0,0):
    // the boolean inserts a vertex there, splitting the edge into two pieces whose
    // union still covers the full span (nothing is consumed).
    const holeSketch = new SketchNode({
        document: body.document,
        plane: bottomPlane(),
        data: {
            // world center (5, 2, 0), radius 2 — tangent to the y=0 edge at x=5
            entities: [{ id: 1, type: "circle", params: [5, -2, 2] }],
            constraints: [],
        },
    });
    body.document.modelManager.addNode(holeSketch);
    body.featuresJson = JSON.stringify([
        { id: "e1", type: "extrude", sketchId: sketch1.id, depth: 10 },
        { id: "e2", type: "extrude", sketchId: holeSketch.id, depth: -2, operation: "cut" },
    ]);

    expect(body.shape.isOk).toBe(true);
    // Precondition: the referenced edge really was split into two covering pieces.
    expect(bottomEdgePieces(body).length).toBe(2);

    // The ref survived the split: not dangling, snapshot and full-span fingerprint
    // unchanged, dead kernel edgeId dropped.
    const resolved = sketch2.data.externalRefs![0];
    expect(resolved.dangling).toBeUndefined();
    expect(resolved.snapshot).toEqual([0, 0, 10, 0]);
    expect(resolved.edge).toEqual({
        kind: "line",
        start: { x: 0, y: 0, z: 0 },
        end: { x: 10, y: 0, z: 0 },
        edgeId: undefined,
    });
    // …and the sketch profile built on it still closes.
    expect(sketch2.shape.isOk).toBe(true);
});

test("a boolean splitting the referenced edge asymmetrically keeps the whole-span fingerprint", () => {
    const { body, sketch1, sketch2 } = setupBoxWithReferencedSketch();

    // Same tangent-vertex split as above, but at x=2: the pieces [0,2] and [2,10]
    // score 8 vs 2 against the stored span, so the span-8 piece wins the geometric
    // match outright (the symmetric case ties and simply fails the match). The
    // whole-span policy must still win because the pieces cover the stored curve.
    const holeSketch = new SketchNode({
        document: body.document,
        plane: bottomPlane(),
        data: {
            // world center (2, 2, 0), radius 2 — tangent to the y=0 edge at x=2
            entities: [{ id: 1, type: "circle", params: [2, -2, 2] }],
            constraints: [],
        },
    });
    body.document.modelManager.addNode(holeSketch);
    body.featuresJson = JSON.stringify([
        { id: "e1", type: "extrude", sketchId: sketch1.id, depth: 10 },
        { id: "e2", type: "extrude", sketchId: holeSketch.id, depth: -2, operation: "cut" },
    ]);

    expect(body.shape.isOk).toBe(true);
    // Precondition: the referenced edge really was split at x=2.
    const pieces = bottomEdgePieces(body);
    expect(pieces.length).toBe(2);
    const spans = pieces
        .map((edge) => [edge.startPoint().x, edge.endPoint().x].sort((a, b) => a - b))
        .sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBeCloseTo(0, 6);
    expect(spans[0][1]).toBeCloseTo(2, 6);
    expect(spans[1][0]).toBeCloseTo(2, 6);
    expect(spans[1][1]).toBeCloseTo(10, 6);

    // The ref survived the split: not dangling, snapshot and full-span fingerprint
    // unchanged — not re-anchored to the span-8 winner — dead kernel edgeId dropped.
    const resolved = sketch2.data.externalRefs![0];
    expect(resolved.dangling).toBeUndefined();
    expect(resolved.snapshot).toEqual([0, 0, 10, 0]);
    expect(resolved.edge).toEqual({
        kind: "line",
        start: { x: 0, y: 0, z: 0 },
        end: { x: 10, y: 0, z: 0 },
        edgeId: undefined,
    });
    expect(sketch2.shape.isOk).toBe(true);
});

test("a cut consuming the referenced edge's middle leaves the profile closed on the stale snapshot", () => {
    const { body, sketch1, sketch2 } = setupBoxWithReferencedSketch();

    // A notch into the front face consuming the edge's middle [3,7]: the remaining
    // pieces no longer cover the stored span, so the ref genuinely dangles.
    const notchSketch = new SketchNode({
        document: body.document,
        plane: bottomPlane(),
        data: {
            // world x 3..7, y 0..5 on the bottom face — a rectangle of 4 lines
            entities: [
                { id: 1, type: "line", params: [3, -5, 7, -5] },
                { id: 2, type: "line", params: [7, -5, 7, 0] },
                { id: 3, type: "line", params: [7, 0, 3, 0] },
                { id: 4, type: "line", params: [3, 0, 3, -5] },
            ],
            constraints: [],
        },
    });
    body.document.modelManager.addNode(notchSketch);
    body.featuresJson = JSON.stringify([
        { id: "e1", type: "extrude", sketchId: sketch1.id, depth: 10 },
        { id: "e2", type: "extrude", sketchId: notchSketch.id, depth: -5, operation: "cut" },
    ]);

    expect(body.shape.isOk).toBe(true);
    // Precondition: the middle really is gone — [0,3] and [7,10] remain.
    const pieces = bottomEdgePieces(body);
    expect(pieces.length).toBe(2);
    const spans = pieces
        .map((edge) => [edge.startPoint().x, edge.endPoint().x].sort((a, b) => a - b))
        .sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBeCloseTo(0, 6);
    expect(spans[0][1]).toBeCloseTo(3, 6);
    expect(spans[1][0]).toBeCloseTo(7, 6);
    expect(spans[1][1]).toBeCloseTo(10, 6);

    // The ref dangles (the editor shows it red), but the profile keeps closing on
    // the frozen snapshot instead of failing the sketch's dependent features.
    const resolved = sketch2.data.externalRefs![0];
    expect(resolved.dangling).toBe(true);
    expect(resolved.snapshot).toEqual([0, 0, 10, 0]);
    const profiles = sketchProfiles(sketch2);
    expect(profiles.isOk).toBe(true);
    expect(profiles.unchecked()!.outer.length).toBe(1);
    expect(profiles.unchecked()!.outer[0].area()).toBeCloseTo(20, 6);

    // Removing the notch brings the edge back: the ref re-resolves, clears the
    // flag and the profile follows the (unchanged) live geometry again.
    body.featuresJson = JSON.stringify([{ id: "e1", type: "extrude", sketchId: sketch1.id, depth: 10 }]);
    expect(body.shape.isOk).toBe(true);
    const recovered = sketch2.data.externalRefs![0];
    expect(recovered.dangling).toBeUndefined();
    expect(recovered.snapshot).toEqual([0, 0, 10, 0]);
    expect(sketchProfiles(sketch2).isOk).toBe(true);
});
