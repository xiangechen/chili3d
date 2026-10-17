// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { I18n, type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { FeatureData, FilletFeatureData, RemoveFeatureFeatureData } from "../src/features/feature";
import { captureProfileRef, type ProfileRef } from "../src/features/profileRef";
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

const BOX_VOLUME = 40 * 40 * 20;

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

/** A 40×40×20 box with a radius-4 fillet on the vertical edge at (20, 20). */
function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch = new SketchNode({
        document: doc,
        id: "sk1",
        plane: Plane.XY,
        data: rect(-20, -20, 20, 20),
    });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [{ id: "e1", type: "extrude", sketchId: sketch.id, depth: 20 }, filletVerticalEdge()],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { doc, sketch, body };
}

function filletVerticalEdge(): FilletFeatureData {
    // A bare geometric fingerprint: the edge sits at corner (20, 20) running up in Z.
    return {
        id: "f1",
        type: "fillet",
        radius: 4,
        edges: [
            {
                kind: "line",
                start: { x: 20, y: 20, z: 0 },
                end: { x: 20, y: 20, z: 20 },
            },
        ],
    };
}

function facesOf(body: ParametricBodyNode): IFace[] {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
}

/** The cylindrical fillet face: the only face whose bbox spans just the corner (4×4 in X/Y). */
function filletFace(body: ParametricBodyNode) {
    const found = facesOf(body)
        .map((face, index) => ({ face, index }))
        .find(({ face }) => {
            const box = face.boundingBox();
            return box.max.x - box.min.x <= 4 + 1e-6 && box.max.y - box.min.y <= 4 + 1e-6;
        });
    expect(found).toBeDefined();
    const id = body.faceIdAt(found!.index);
    return captureProfileRef(found!.face, id, body.faceIdIsShared(id));
}

/** A ref whose fingerprint sits a metre away — nothing can claim it. */
function bogusRef(): ProfileRef {
    return {
        edges: [
            {
                kind: "line",
                start: { x: 1000, y: 1000, z: 1000 },
                end: { x: 1001, y: 1000, z: 1000 },
            },
        ],
        center: { x: 1000, y: 1000, z: 1000 },
        area: 25,
    };
}

function withRemoveFeature(body: ParametricBodyNode, faces: ProfileRef[]) {
    const feature: RemoveFeatureFeatureData = { id: "rm1", type: "removeFeature", faces };
    body.setFeaturesEmitShapeChanged([...body.features, feature]);
}

describe("removeFeature feature", () => {
    test("removing the fillet face heals the corner — the box volume comes back", () => {
        const { body } = setup();
        const filletedVolume = body.shape.unchecked()!.volume();
        expect(filletedVolume).toBeLessThan(BOX_VOLUME);

        withRemoveFeature(body, [filletFace(body)]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(BOX_VOLUME, 3);
    });

    test("a lost pick is reported while the rest still removes", () => {
        const { body } = setup();
        withRemoveFeature(body, [bogusRef(), filletFace(body)]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(BOX_VOLUME, 3);
        const item = body.featureItems()[2];
        expect(item.error).toBeUndefined();
        expect(item.missingInputs?.length).toBe(1);
        expect(item.warning).toBe(I18n.translate("body.missingInputs{0}", 1));
    });

    test("when every pick is lost the feature fails instead of rebuilding to the input", () => {
        const { body } = setup();
        const before = body.shape.unchecked()!;
        withRemoveFeature(body, [bogusRef()]);

        // A failed feature keeps the last good shape; the row carries the error.
        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()!).toBe(before);
        expect(body.featureItems()[2].error).toBe("Face not found after rebuild");
    });

    test("the feature requires a preceding feature", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [{ id: "rm1", type: "removeFeature", faces: [bogusRef()] } as FeatureData],
        });
        doc.modelManager.addNode(body);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Remove feature requires a preceding feature");
    });
});
