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

const round = (x: number) => Math.round(x * 1e3) / 1e3;

/** Tracked id → the geometry that id names, direction-insensitive (traversal may flip). */
function idGeometry(body: ParametricBodyNode): Map<string, string[]> {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const byId = new Map<string, string[]>();
    edges.forEach((edge, index) => {
        const id = body.edgeIdAt(index);
        if (id === undefined) return;
        const s = edge.startPoint();
        const t = edge.endPoint();
        const ends = [
            `${round(s.x)},${round(s.y)},${round(s.z)}`,
            `${round(t.x)},${round(t.y)},${round(t.z)}`,
        ].sort();
        const entry = `${edge.curve.basisCurve.curveType} ${ends[0]}~${ends[1]}`;
        const list = byId.get(id);
        if (list === undefined) byId.set(id, [entry]);
        else list.push(entry);
    });
    for (const list of byId.values()) list.sort();
    return byId;
}

const forward: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 40, 0] },
        { id: 2, type: "line", params: [40, 0, 40, 20] },
        { id: 3, type: "line", params: [40, 20, 0, 20] },
        { id: 4, type: "line", params: [0, 20, 0, 0] },
    ],
    constraints: [],
};

const flipped: SketchData = {
    entities: [
        { id: 1, type: "line", params: [40, 0, 0, 0] },
        { id: 2, type: "line", params: [40, 20, 40, 0] },
        { id: 3, type: "line", params: [0, 20, 40, 20] },
        { id: 4, type: "line", params: [0, 0, 0, 20] },
    ],
    constraints: [],
};

test("a tracked id names the same edge after a traversal-only edit", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: forward });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 10,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);

    const before = idGeometry(body);
    // The identical rectangle, every line traversed the other way: no geometry changed.
    sketch.setDataEmitShapeChanged(flipped);
    const after = idGeometry(body);

    const drifted = [...before.entries()]
        .map(([id, geometry]) => ({ id, before: geometry, after: after.get(id) }))
        .filter((entry) => JSON.stringify(entry.before) !== JSON.stringify(entry.after));
    // Every stored id must still name the edge it was captured from: the profile seeds
    // are content-derived, and the edges the kernel history cannot attribute must be too.
    expect(
        drifted.map((entry) => `${entry.id}: ${entry.before.join("/")} -> ${entry.after?.join("/")}`),
    ).toEqual([]);
});

test("a fillet's own edges keep their ids across a traversal-only edit", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: forward });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 10,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);

    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const verticals = edges
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

    const before = idGeometry(body);
    // The same rectangle, every line traversed the other way: no geometry changed, so the
    // fillet's own seams and end arcs must still answer to the ids they were given.
    sketch.setDataEmitShapeChanged(flipped);
    expect(idGeometry(body)).toEqual(before);
});

test("a chamfer's strips are named by content, its slanted ends are not (yet)", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: forward });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 10,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
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
        { id: "c1", type: "chamfer", distance: 2, edges: verticals },
    ]);
    expect(body.featureItems()[1].error).toBeUndefined();

    const ids = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[]).map(
        (_, index) => body.edgeIdAt(index) ?? "?",
    );
    // The two strips running ALONG each chamfered edge stand a `distance` away from it, which
    // is what `builtFrom` measures: 2 per chamfered edge, all content-derived.
    expect(ids.filter((id) => id.includes(":f"))).toHaveLength(8);
    // The slanted end edges cross the corner instead of running along it, so the measure cannot
    // reach them: they keep the positional id, and `edgeMatcher` weighs that as the weak hint it
    // is. Pinned here so a future refinement is a visible change, not a silent one.
    expect(ids.filter((id) => id.includes("@")).length).toBe(8);
    expect(ids.filter((id) => id === "?")).toEqual([]);
});
