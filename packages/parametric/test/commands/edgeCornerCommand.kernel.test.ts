// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Matrix4, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { ChamferFeatureCommand, FilletFeatureCommand } from "../../src/commands/edgeCornerCommand";
import type { FilletFeatureData } from "../../src/features/feature";
import { captureProfileRef } from "../../src/features/profileRef";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import type { SketchData } from "../../src/sketch/sketchModel";
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

const RECT: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 40, 0] },
        { id: 2, type: "line", params: [40, 0, 40, 20] },
        { id: 3, type: "line", params: [40, 20, 0, 20] },
        { id: 4, type: "line", params: [0, 20, 0, 0] },
    ],
    constraints: [],
};

/** A box body, with its vertical edge indexes — what the pick command consumes. */
function scenario() {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    (app as any).activeView = { document: doc };
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: RECT });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
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
    expect(body.shape.isOk).toBe(true);
    // The value setter previews against the live selection; the pick itself is driven through
    // `stepDatas`, so an empty selection is all the preview needs to bow out.
    (doc as any).selection = { getSelectedShapes: () => [] };
    return { app, doc, body };
}

/** The index of a vertical edge (its endpoints differ in z alone). */
function verticalEdgeIndex(body: ParametricBodyNode): number {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const index = edges.findIndex((edge) => {
        const s = edge.startPoint();
        const e = edge.endPoint();
        return Math.abs(s.x - e.x) < 1e-6 && Math.abs(s.y - e.y) < 1e-6 && Math.abs(s.z - e.z) > 1e-6;
    });
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}

/** Drives the pick + commit the way the step machinery does, then hands back the new feature. */
function pickAndCommit(
    command: FilletFeatureCommand | ChamferFeatureCommand,
    app: unknown,
    body: ParametricBodyNode,
    index: number,
    value: number,
) {
    const edge = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])[index];
    (command as any)._application = app;
    command.value = value;
    (command as any).stepDatas = [
        {
            nodes: [body],
            shapes: [{ shape: edge, owner: { node: body }, indexes: [index], transform: Matrix4.identity() }],
        },
    ];
    (command as any).executeMainTask();
    expect(body.features).toHaveLength(2);
    return body.features[1] as { readonly edges: { readonly edgeId?: string }[] };
}

describe("EdgeCornerFeatureCommand id capture", () => {
    test("a picked fillet edge is captured with the id its body tracks", () => {
        const { app, body } = scenario();

        const feature = pickAndCommit(new FilletFeatureCommand(), app, body, verticalEdgeIndex(body), 2);

        // The point of the capture site: the ref carries the edge's own id, so a later
        // rebuild resolves it by id rather than re-finding it geometrically.
        expect(feature.edges).toHaveLength(1);
        expect(feature.edges[0].edgeId).toContain("sketch:sk1:");
        expect(body.featureItems()[1].error).toBeUndefined();
    });

    test("a picked chamfer edge is captured with the id its body tracks", () => {
        const { app, body } = scenario();

        const feature = pickAndCommit(new ChamferFeatureCommand(), app, body, verticalEdgeIndex(body), 2);

        expect(feature.edges[0].edgeId).toContain("sketch:sk1:");
        expect(body.featureItems()[1].error).toBeUndefined();
    });

    test("the captured id survives an upstream edit that moves the geometry", () => {
        const { app, doc, body } = scenario();
        const feature = pickAndCommit(new FilletFeatureCommand(), app, body, verticalEdgeIndex(body), 2);
        const captured = feature.edges[0].edgeId;

        // Move the rectangle. The entity ids — and so the captured id — are unchanged, and the
        // fillet still resolves: an id follows the geometry it names, where a fingerprint would
        // have had to be re-matched (and could have landed on a look-alike edge).
        const sketch = doc.modelManager.findNode((node) => node instanceof SketchNode) as SketchNode;
        sketch.setDataEmitShapeChanged({
            entities: RECT.entities.map((e) => ({
                ...e,
                params: e.params.map((p, i) => (i % 2 === 0 ? p : p + 5)),
            })),
            constraints: [],
        });

        expect(body.featureItems()[1].error).toBeUndefined();
        expect((body.features[1] as FilletFeatureData).edges[0].edgeId).toBe(captured);
    });
});
