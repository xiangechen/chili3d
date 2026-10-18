// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    BoundingBox,
    type IEdge,
    type IFace,
    Matrix4,
    Plane,
    ShapeTypes,
    Transaction,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { ExtrudeFeatureData, TransformFeatureData } from "../src/features/feature";
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

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

function newDoc(): TestDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function extent(body: ParametricBodyNode): number[] {
    const box = body.shape.unchecked()!.boundingBox();
    return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(round);
}

function addSketch(doc: TestDocument, z: number, rectData: SketchData): SketchNode {
    const sketch = new SketchNode({
        document: doc,
        plane: new Plane({ origin: new XYZ({ x: 0, y: 0, z }), normal: XYZ.unitZ, xvec: XYZ.unitX }),
        data: rectData,
    });
    doc.modelManager.addNode(sketch);
    return sketch;
}

function firstProfile(sketch: SketchNode) {
    const faces = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    return captureProfileRef(faces[0].shape as unknown as IFace);
}

/** A 10×10×10 block on the XY plane, plus an optional 2×2 boss joined on its top. */
function blockWithBoss(doc: TestDocument): { body: ParametricBodyNode; bossFeatureId: string } {
    const base = addSketch(doc, 0, rect(0, 0, 10, 10));
    const boss = addSketch(doc, 10, rect(2, 2, 4, 4));
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            { id: "e1", type: "extrude", sketchId: base.id, depth: 10, profiles: [firstProfile(base)] },
            {
                id: "e2",
                type: "extrude",
                sketchId: boss.id,
                depth: 5,
                operation: "fuse",
                profiles: [firstProfile(boss)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    return { body, bossFeatureId: "e2" };
}

function move(body: ParametricBodyNode, x: number, y: number, z: number): void {
    Transaction.execute(body.document, "move", () => {
        body.applyTransform(Matrix4.fromTranslation(x, y, z));
    });
}

describe("transform feature follows the chain", () => {
    test("records a move as the last feature and keeps the node transform identity", () => {
        const { body } = blockWithBoss(newDoc());
        expect(extent(body)).toEqual([0, 0, 0, 10, 10, 15]);

        move(body, 100, 0, 0);

        expect(extent(body)).toEqual([100, 0, 0, 110, 10, 15]);
        expect(body.transform.equals(Matrix4.identity())).toBe(true);
        const last = body.features.at(-1) as TransformFeatureData;
        expect(last.type).toBe("transform");
        expect(last.matrix[12]).toBe(100);
    });

    test("a feature rebuilt after the move stays in the moved place", () => {
        const { body, bossFeatureId } = blockWithBoss(newDoc());
        move(body, 100, 0, 0);

        // This was the regression: the joining tool was mapped through the stale host
        // transform and landed at −98, so the result spanned [−98, 10] locally.
        Transaction.execute(body.document, "edit boss", () => {
            body.setFeaturesEmitShapeChanged(
                body.features.map((feature) =>
                    feature.id === bossFeatureId
                        ? ({ ...(feature as ExtrudeFeatureData), depth: 5.001 } as ExtrudeFeatureData)
                        : feature,
                ),
            );
        });

        expect(extent(body)).toEqual([100, 0, 0, 110, 10, 15.001]);
    });

    test("refuses a non-uniform scale instead of recording a broken feature", () => {
        const { body } = blockWithBoss(newDoc());
        const before = body.features.length;

        const applied = body.applyTransform(Matrix4.fromScale(2, 1, 1));

        expect(applied).toBe(false);
        expect(body.features).toHaveLength(before);
        expect(body.transform.equals(Matrix4.identity())).toBe(true);
    });

    test("a move is inserted at the rollback bar and keeps it hiding later features", () => {
        const { body } = blockWithBoss(newDoc());
        Transaction.execute(body.document, "rollback", () => {
            body.rollbackBarIndex = 1;
        });
        expect(extent(body)).toEqual([0, 0, 0, 10, 10, 10]);

        move(body, 100, 0, 0);

        // The boss stays hidden: the move applies to the visible chain only.
        expect(extent(body)).toEqual([100, 0, 0, 110, 10, 10]);
        expect(body.rollbackBarIndex).toBe(2);
        expect(body.features.map((x) => x.type)).toEqual(["extrude", "transform", "extrude"]);
    });

    test("a stale bar at the feature count does not swallow the move", () => {
        const { body, bossFeatureId } = blockWithBoss(newDoc());
        Transaction.execute(body.document, "rollback", () => {
            body.rollbackBarIndex = 1;
        });
        // Removing the tail leaves the stored bar equal to the new count — an inert
        // value that turns active again as soon as a feature is appended behind it.
        Transaction.execute(body.document, "remove feature", () => {
            body.removeFeature(bossFeatureId);
        });
        expect(body.rollbackBarIndex).toBe(1);
        expect(body.features).toHaveLength(1);

        move(body, 100, 0, 0);

        expect(extent(body)).toEqual([100, 0, 0, 110, 10, 10]);
        expect(body.features.at(-1)!.type).toBe("transform");
        // The full chain is visible again, so the stale bar is cleared.
        expect(body.rollbackBarIndex).toBeUndefined();
    });

    test("refuses a move when the rollback bar hides the whole chain", () => {
        const { body } = blockWithBoss(newDoc());
        Transaction.execute(body.document, "legacy placement", () => {
            body.transform = Matrix4.fromTranslation(5, 0, 0);
        });
        Transaction.execute(body.document, "rollback", () => {
            body.rollbackBarIndex = 0;
        });
        expect(body.rollbackBarIndex).toBe(0);
        const before = body.transform;
        const featureCount = body.features.length;

        const applied = body.applyTransform(Matrix4.fromTranslation(100, 0, 0));

        // No feature can be recorded at the top of the chain; the attempt must leave the
        // node's placement alone instead of clearing it.
        expect(applied).toBe(false);
        expect(body.transform.equals(before)).toBe(true);
        expect(body.features).toHaveLength(featureCount);
    });

    test("two moves accumulate as two features", () => {
        const { body } = blockWithBoss(newDoc());
        move(body, 100, 0, 0);
        move(body, 0, 20, 0);

        expect(extent(body)).toEqual([100, 20, 0, 110, 30, 15]);
        expect(body.features.filter((x) => x.type === "transform")).toHaveLength(2);
    });

    test("edge ids survive the move, so a later fillet resolves by id", () => {
        const doc = newDoc();
        const sketch = addSketch(doc, 0, rect(0, 0, 10, 10));
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch.id,
                    depth: 10,
                    profiles: [firstProfile(sketch)],
                },
            ],
        });
        doc.modelManager.addNode(body);
        const edgesBefore = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[]).map((edge) =>
            captureEdgeRef(edge),
        );

        move(body, 100, 0, 0);

        const edgesAfter = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
        expect(edgesAfter).toHaveLength(edgesBefore.length);
        const vertical = edgesAfter.find((edge) => {
            const box = BoundingBox.center(edge.boundingBox());
            return round(box.x) === 100 && round(box.y) === 0 && round(box.z) === 5;
        });
        expect(vertical).toBeDefined();

        Transaction.execute(doc, "fillet", () => {
            body.setFeaturesEmitShapeChanged([
                ...body.features,
                { id: "f1", type: "fillet", radius: 2, edges: [captureEdgeRef(vertical!)] },
            ]);
        });

        expect(body.featureItems().filter((x) => x.error !== undefined)).toEqual([]);
        const box = body.shape.unchecked()!.boundingBox();
        expect(round(box.min.x)).toBe(100);
        expect(round(box.max.x)).toBe(110);
    });
});
