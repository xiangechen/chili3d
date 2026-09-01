// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";
import { captureFaceRef, type PlaneFaceRef, resolveFacePlane } from "../src/sketch/planeRef";

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

// A dimension edit can make the solver mirror the profile (points cross over),
// which flips the wire orientation and reorders the prism's side faces.
function squareMirrored(size: number): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [0, 0, 0, size] },
            { id: 2, type: "line", params: [0, size, size, size] },
            { id: 3, type: "line", params: [size, size, size, 0] },
            { id: 4, type: "line", params: [size, 0, 0, 0] },
        ],
        constraints: [],
    };
}

function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: square(10) });
    doc.modelManager.addNode(sketch1);
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "f1", type: "extrude", sketchId: sketch1.id, length: 10 }],
    });
    doc.modelManager.addNode(body);
    return { doc, sketch1, body };
}

/** Plane ref of the +X side face (x = 10 before the resize). */
function sideFaceRef(doc: TestDocument, body: ParametricBodyNode): PlaneFaceRef {
    expect(body.shape.isOk).toBe(true);
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    const sideIndex = faces.findIndex((face) => face.normal(0, 0)[1].x > 0.9);
    expect(sideIndex).toBeGreaterThanOrEqual(0);
    const faceId = body.faceIdAt(sideIndex);
    // side faces are seeded by the generating profile edge, not by face order
    expect(faceId).toMatch(/^sketch:.+:0:e\d+$/);
    return { ...captureFaceRef(body.id, faces[sideIndex]), faceId };
}

function plusXFaceIndex(body: ParametricBodyNode): number {
    const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
    return faces.findIndex((face) => face.normal(0, 0)[1].x > 0.9);
}

function expectPlusXFace(doc: TestDocument, ref: PlaneFaceRef, offset: number) {
    const plane = resolveFacePlane(doc, ref);
    expect(plane).toBeDefined();
    expect(plane!.normal.x).toBeCloseTo(1, 6);
    expect(plane!.normal.y).toBeCloseTo(0, 6);
    expect(plane!.normal.dot(plane!.origin)).toBeCloseTo(offset, 6);
}

describe("sketch plane follows the referenced face (real kernel)", () => {
    test("profile resize moves the plane along the face normal", () => {
        const { doc, sketch1, body } = setup();
        const ref = sideFaceRef(doc, body);
        expectPlusXFace(doc, ref, 10);

        sketch1.setDataEmitShapeChanged(square(20));

        // the edge-seeded id indexes the +X face directly after the rebuild
        expect(body.faceIndexById(ref.faceId!)).toBe(plusXFaceIndex(body));
        expectPlusXFace(doc, ref, 20);
    });

    test("mirrored profile reorders faces; the plane still tracks the same side", () => {
        const { doc, sketch1, body } = setup();
        const ref = sideFaceRef(doc, body);
        expectPlusXFace(doc, ref, 10);

        sketch1.setDataEmitShapeChanged(squareMirrored(20));

        // the rebuild swaps the side-face order, so the stored faceId now indexes a
        // +Y face — the normal check must reject it and the fingerprint re-match +X
        expectPlusXFace(doc, ref, 20);
    });
});
