// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    BodyInstanceNode,
    type BoundingBox,
    Component,
    cloneForCopyNode,
    FaceMaterialPair,
    type IFace,
    Matrix4,
    Plane,
    Serializer,
    ShapeTypes,
    Transaction,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { ExtrudeFeatureData } from "../src/features/feature";
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

function boxBody(doc: TestDocument, size: number): ParametricBodyNode {
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, size, size) });
    doc.modelManager.addNode(sketch);
    const faces = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: size,
                profiles: [captureProfileRef(faces[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    return body;
}

function extent(node: { boundingBox(): BoundingBox | undefined }): number[] {
    const box = node.boundingBox()!;
    return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(round);
}

describe("BodyInstanceNode", () => {
    test("renders the source's shape at its own placement", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.fromTranslation(100, 0, 0));

        expect(instance).not.toBe(body);
        doc.modelManager.addNode(instance);

        expect(instance.transform.equals(Matrix4.fromTranslation(100, 0, 0))).toBe(true);
        expect(extent(instance)).toEqual([100, 0, 0, 110, 10, 10]);
        expect(extent(body)).toEqual([0, 0, 0, 10, 10, 10]);
    });

    test("follows the source when the source's feature chain rebuilds", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.fromTranslation(100, 0, 0));
        doc.modelManager.addNode(instance);

        // Touch the mesh first so the instance subscribes to the source's shape.
        expect(extent(instance)).toEqual([100, 0, 0, 110, 10, 10]);

        Transaction.execute(doc, "edit depth", () => {
            body.setFeaturesEmitShapeChanged(
                body.features.map((feature) => (feature.id === "e1" ? { ...feature, depth: 20 } : feature)),
            );
        });

        expect(extent(instance)).toEqual([100, 0, 0, 110, 10, 20]);
    });

    test("moving the source carries every instance; moving an instance only moves itself", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.identity());
        doc.modelManager.addNode(instance);
        expect(extent(instance)).toEqual([0, 0, 0, 10, 10, 10]);

        Transaction.execute(doc, "move source", () => {
            body.applyTransform(Matrix4.fromTranslation(100, 0, 0));
        });
        expect(extent(body)).toEqual([100, 0, 0, 110, 10, 10]);
        expect(extent(instance)).toEqual([100, 0, 0, 110, 10, 10]);

        Transaction.execute(doc, "move instance", () => {
            instance.applyTransform(Matrix4.fromTranslation(0, 50, 0));
        });
        expect(extent(instance)).toEqual([100, 50, 0, 110, 60, 10]);
        expect(extent(body)).toEqual([100, 0, 0, 110, 10, 10]);
    });

    test("serializes its source reference and placement", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.fromTranslation(100, 0, 0)) as BodyInstanceNode;

        const serialized = Serializer.serializeObject(instance);
        const restored = Serializer.deserializeObject(doc, serialized) as BodyInstanceNode;

        expect(restored).toBeInstanceOf(BodyInstanceNode);
        expect(restored.sourceId).toBe(body.id);
        expect(restored.transform.equals(Matrix4.fromTranslation(100, 0, 0))).toBe(true);
    });

    test("a sketch copies independently, never as an instance", () => {
        const doc = newDoc();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: rect(0, 0, 10, 10) });
        doc.modelManager.addNode(sketch);

        const copy = cloneForCopyNode(sketch, Matrix4.fromTranslation(10, 0, 0));

        expect(copy).toBeInstanceOf(SketchNode);
        expect(copy).not.toBeInstanceOf(BodyInstanceNode);
        expect(copy.transform.equals(Matrix4.identity())).toBe(true);
    });

    test("carries the source's material and per-face paint", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        body.materialId = "mat-red";
        body.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 0, materialIndex: 1 })];

        const instance = body.cloneForCopy(Matrix4.identity()) as BodyInstanceNode;

        expect(instance.materialId).toBe("mat-red");
        expect(instance.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex])).toEqual([[0, 1]]);
    });

    test("merges the instance's paint from the source's RAW faces, not its merged mesh", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        body.materialId = ["mat-default", "mat-red"];
        body.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 2, materialIndex: 1 })];
        const instance = body.cloneForCopy(Matrix4.identity()) as BodyInstanceNode;

        const sourceFaces = body.mesh.faces;
        const instanceFaces = instance.mesh.faces;

        expect(sourceFaces).toBeDefined();
        expect(instanceFaces).toBeDefined();
        // The face ORDER is what the double merge corrupts; groups and counts happen to
        // match in both implementations. `range[i].shape.index` is the original face.
        const faceOrder = (mesh: { range: { shape: { index: number } }[] }) =>
            mesh.range.map((x) => x.shape.index);
        const sourceOrder = faceOrder(sourceFaces!);
        expect(faceOrder(instanceFaces!)).toEqual(sourceOrder);
        // The scenario must actually reorder faces, or the assertion above is vacuous.
        expect(sourceOrder).not.toEqual([...sourceOrder].sort((a, b) => a - b));
    });

    test("an unpainted instance groups its raw faces, not the source's later paint", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.identity()) as BodyInstanceNode;
        doc.modelManager.addNode(instance);
        expect(instance.faceMaterialPair).toHaveLength(0);

        // The source gains a second material AFTER the instance copied its own palette.
        body.materialId = ["mat-default", "mat-red"];
        body.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 2, materialIndex: 1 })];
        // A source rebuild drops the instance's cached mesh; this edit emits "shape".
        Transaction.execute(doc, "rebuild source", () => {
            body.setFeaturesEmitShapeChanged(
                body.features.map((feature) =>
                    feature.id === "e1"
                        ? ({ ...(feature as ExtrudeFeatureData), depth: 10.001 } as ExtrudeFeatureData)
                        : feature,
                ),
            );
        });

        // The scenario must actually paint the source, or the assertion is vacuous.
        expect((body.mesh.faces?.groups ?? []).some((group) => group.materialIndex === 1)).toBe(true);
        // The source's merged mesh would carry that index; the instance's palette does
        // not have it, so its own faces must stay ungrouped (index 0 everywhere).
        const groups = instance.mesh.faces?.groups ?? [];
        expect(groups.some((group) => group.materialIndex !== 0)).toBe(false);
    });

    test("copies face-material pairs by value, so removing one on an instance leaves the source alone", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        body.materialId = ["mat-a", "mat-b"];
        body.faceMaterialPair = [new FaceMaterialPair({ faceIndex: 1, materialIndex: 1 })];
        const instance = body.cloneForCopy(Matrix4.identity()) as BodyInstanceNode;

        expect(instance.faceMaterialPair[0]).not.toBe(body.faceMaterialPair[0]);
        instance.faceMaterialPair[0].materialIndex = 0;

        expect(body.faceMaterialPair[0].materialIndex).toBe(1);
    });

    test("warns while the parametric source is missing", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.identity()) as BodyInstanceNode;
        doc.modelManager.addNode(instance);
        expect(instance.warningCount).toBe(0);

        body.dispose();

        expect(instance.warningCount).toBe(1);
        expect(instance.warningTooltip).toBe("body.instance.sourceMissing");
    });

    test("stops reading a source that has been disposed", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.identity()) as BodyInstanceNode;
        expect(instance.shape.isOk).toBe(true);

        body.dispose();

        expect(instance.source).toBeUndefined();
        expect(instance.shape.isOk).toBe(false);
    });

    test("painting an instance never mutates the source's shared mesh", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.identity()) as BodyInstanceNode;

        const sourceMesh = body.mesh;
        const sourceFaces = sourceMesh.faces;
        expect(sourceFaces).toBeDefined();
        expect(instance.mesh).not.toBe(sourceMesh);

        instance.addFaceMaterial([{ faceIndex: 0, materialId: "mat-red" }]);

        expect(sourceMesh.faces).toBe(sourceFaces);
        expect(body.materialId).not.toBe("mat-red");
    });

    test("reports the source's shape type instead of the uninitialized placeholder", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.identity()) as BodyInstanceNode;
        expect(body.shape.isOk).toBe(true);

        expect(body.shapeType).toBe("Solid");
        expect(instance.shapeType).toBe(body.shapeType);
    });

    test("keeps following a live source moved into a Component definition", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.fromTranslation(100, 0, 0)) as BodyInstanceNode;
        doc.modelManager.addNode(instance);

        // `group` transfers the source out of the document tree into a Component.
        body.parent?.transfer(body);
        const component = new Component({ name: "frozen", nodes: [body] });
        doc.modelManager.components.push(component);

        expect(instance.source).toBe(body);
        expect(extent(instance)).toEqual([100, 0, 0, 110, 10, 10]);

        Transaction.execute(doc, "edit grouped source depth", () => {
            body.setFeaturesEmitShapeChanged(
                body.features.map((feature) => (feature.id === "e1" ? { ...feature, depth: 20 } : feature)),
            );
        });
        expect(extent(instance)).toEqual([100, 0, 0, 110, 10, 20]);
    });

    test("the instance never owns the source shape", () => {
        const doc = newDoc();
        const body = boxBody(doc, 10);
        const instance = body.cloneForCopy(Matrix4.identity());
        doc.modelManager.addNode(instance);
        const sourceShape = body.shape.unchecked()!;

        instance.disposeInternal();

        expect(sourceShape.isNull()).toBe(false);
        expect(body.shape.isOk).toBe(true);
    });
});
