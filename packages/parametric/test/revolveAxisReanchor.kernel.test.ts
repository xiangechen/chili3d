// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BoundingBox, type IEdge, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { RevolveFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
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

// The revolve profile lives in the XZ plane (u → x, v → z) and revolves around Z.
const XZ_PLANE = new Plane({
    origin: XYZ.zero,
    normal: new XYZ({ x: 0, y: -1, z: 0 }),
    xvec: XYZ.unitX,
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

/** Profile rectangle in the XZ plane's UV: x u0..u0+10, z 0..30 — clear of the axis. */
const profile = (u0: number): SketchData => rect(u0, 0, u0 + 10, 30);

/** Box [x0,x0+1]×[0,1]×[0,30] whose vertical corner edges can serve as the axis. */
function axisSource(doc: TestDocument, x0: number) {
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(x0, 0, x0 + 1, 1) });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 30 }],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { sketch, body };
}

/** The vertical edge at corner (x, 0) of the source box. */
function cornerEdge(body: ParametricBodyNode, x: number): IEdge {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const edge = edges.find((e) => {
        const [p, q] = [e.startPoint(), e.endPoint()];
        const onCorner = (v: XYZ) => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y) < 1e-6;
        return onCorner(p) && onCorner(q) && Math.abs(Math.abs(p.z - q.z) - 30) < 1e-6;
    });
    expect(edge).toBeDefined();
    return edge!;
}

function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const source = axisSource(doc, 0);
    const sketch = new SketchNode({ document: doc, plane: XZ_PLANE, data: profile(10) });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "r1",
                type: "revolve",
                sketchId: sketch.id,
                axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                // Captured exactly as the revolve command does at pick time — no id.
                axisSource: { nodeId: source.body.id, edge: captureEdgeRef(cornerEdge(source.body, 0)) },
                angle: 90,
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { doc, sketch, source, body };
}

function revolveFeature(body: ParametricBodyNode): RevolveFeatureData {
    return body.features[0] as RevolveFeatureData;
}

function bbox(body: ParametricBodyNode): BoundingBox {
    const box = body.shape.unchecked()!.boundingBox();
    expect(box).toBeDefined();
    return box!;
}

describe("revolve axis re-anchoring (real kernel)", () => {
    test("the id-less axis ref gains the matched edge's id and keeps it from then on", () => {
        const { sketch, source, body } = setup();

        // The first chain already re-anchors: the ref was captured without an id
        // (see the revolve command) and gains the source edge's tracked id.
        const anchored = revolveFeature(body).axisSource?.edge;
        expect(anchored?.edgeId).toBeDefined();
        const sourceIds = (source.body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[]).map(
            (_, index) => source.body.edgeIdAt(index),
        );
        expect(sourceIds).toContain(anchored!.edgeId);
        const anchoredJson = body.featuresJson;

        // A rigid move resolves by id again — the anchor passes through unchanged.
        source.sketch.setDataEmitShapeChanged(rect(2, 0, 3, 1));
        expect(body.shape.isOk).toBe(true);
        expect(body.featureItems()[0].error).toBeUndefined();
        expect(body.featuresJson).toBe(anchoredJson);
        expect(sketch.shape.isOk).toBe(true);
    });

    test("the axis follows the moved source edge instead of falling back to the snapshot", () => {
        const { source, body } = setup();
        // 90° around the Z axis at x=0: the sector spans x 0..20, |y| up to 20.
        const before = bbox(body);
        expect(before.min.x).toBeCloseTo(0, 3);
        expect(Math.max(Math.abs(before.min.y), Math.abs(before.max.y))).toBeCloseTo(20, 3);

        // Move the source box +5 in x: the picked corner edge moves from x=0 to x=5.
        source.sketch.setDataEmitShapeChanged(rect(5, 0, 6, 1));

        expect(body.shape.isOk).toBe(true);
        expect(body.featureItems()[0].error).toBeUndefined();
        // Following the moved edge, the revolve sweeps around the axis at x=5:
        // radii 5..15 instead of 10..20. The frozen snapshot would repeat the old box.
        const after = bbox(body);
        expect(after.min.x).toBeCloseTo(5, 3);
        expect(Math.max(Math.abs(after.min.y), Math.abs(after.max.y))).toBeCloseTo(15, 3);
        expect(revolveFeature(body).axisSource?.edge.edgeId).toBeDefined();
    });

    test("a revolve's profile refs re-anchor on the matched profile after a sketch edit", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const sketch = new SketchNode({ document: doc, plane: XZ_PLANE, data: profile(10) });
        doc.modelManager.addNode(sketch);
        const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
        expect(profiles).toHaveLength(1);
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "r1",
                    type: "revolve",
                    sketchId: sketch.id,
                    axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                    angle: 90,
                    profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
                },
            ],
        });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);

        // Move the profile +2 in u (x); the sole profile is adopted as moved
        // geometry and the stored ref re-anchors to the match.
        sketch.setDataEmitShapeChanged(profile(12));

        expect(body.shape.isOk).toBe(true);
        expect(body.featureItems()[0].error).toBeUndefined();
        const stored = revolveFeature(body).profiles;
        expect(stored).toHaveLength(1);
        expect(stored![0].center?.x).toBeCloseTo(17, 3);
    });
});
