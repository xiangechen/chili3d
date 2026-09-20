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

/**
 * A rectangle with one side ON the Y axis, so the profile's plane CONTAINS the revolve axis —
 * the ordinary revolve, whose solid is a body of revolution (a half cylinder here). The profile
 * then generates both families the kernel's edge history cannot attribute: the arc a profile
 * corner sweeps, and the end-cap edge a profile edge sweeps.
 */
const forward: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 10, 0] },
        { id: 2, type: "line", params: [10, 0, 10, 10] },
        { id: 3, type: "line", params: [10, 10, 0, 10] },
        { id: 4, type: "line", params: [0, 10, 0, 0] },
    ],
    constraints: [],
};

// The identical rectangle, every line traversed the other way: no geometry changed.
const flipped: SketchData = {
    entities: [
        { id: 1, type: "line", params: [10, 0, 0, 0] },
        { id: 2, type: "line", params: [10, 10, 10, 0] },
        { id: 3, type: "line", params: [0, 10, 10, 10] },
        { id: 4, type: "line", params: [0, 0, 0, 10] },
    ],
    constraints: [],
};

function revolveBody(doc: TestDocument, sketch: SketchNode): ParametricBodyNode {
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    expect(profiles).toHaveLength(1);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "r1",
                type: "revolve",
                sketchId: sketch.id,
                axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
                angle: 180,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    return body;
}

function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: forward });
    doc.modelManager.addNode(sketch);
    const body = revolveBody(doc, sketch);
    expect(body.shape.isOk).toBe(true);
    return { sketch, body };
}

/** Refs of every ARC of the revolve — the edges a profile corner sweeps. */
function arcRefs(body: ParametricBodyNode) {
    return (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => edge.curve.basisCurve.curveType === "circle")
        .map(({ edge, index }) => captureEdgeRef(edge, body.edgeIdAt(index), false));
}

test("a revolve names both swept families by content, not by enumeration", () => {
    const { body } = setup();
    const ids = [...idGeometry(body).keys()].sort();

    // Every one of the revolve's nine edges is named from the profile and nothing is left
    // unnamed — `idGeometry` skips an id-less edge, so a complete list is the whole shape.
    expect(idGeometry(body).size).toBe(9);
    expect(ids).toEqual([
        "sketch:sk1:e1.2.3.4:ent1",
        "sketch:sk1:e1.2.3.4:ent1:cap",
        "sketch:sk1:e1.2.3.4:ent2",
        "sketch:sk1:e1.2.3.4:ent2:cap",
        "sketch:sk1:e1.2.3.4:ent3",
        "sketch:sk1:e1.2.3.4:ent3:cap",
        "sketch:sk1:e1.2.3.4:ent4",
        "sketch:sk1:e1.2.3.4:v1.2",
        "sketch:sk1:e1.2.3.4:v2.3",
    ]);
    // Each arc is the corner of two entities swept: (10,10) joins entities 2 and 3, (10,0) 1 and 2.
    expect(arcRefs(body).map((ref) => ref.edgeId)).toEqual([
        "sketch:sk1:e1.2.3.4:v2.3",
        "sketch:sk1:e1.2.3.4:v1.2",
    ]);
});

test("a fillet on a revolved arc keeps its edge across a traversal-only edit", () => {
    const { sketch, body } = setup();

    const arcs = arcRefs(body);
    expect(arcs).toHaveLength(2);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        { id: "f1", type: "fillet", radius: 1, edges: [arcs[0]] },
    ]);
    expect(body.featureItems()[1].error).toBeUndefined();

    const before = idGeometry(body);
    // The same rectangle, every line traversed the other way: no geometry changed, so the fillet
    // must still sit on the arc it was picked from — the arc's id follows the corner that swept
    // it, not its position in the rebuilt shape's enumeration.
    sketch.setDataEmitShapeChanged(flipped);
    expect(body.featureItems()[1].error).toBeUndefined();
    expect(idGeometry(body)).toEqual(before);
});
