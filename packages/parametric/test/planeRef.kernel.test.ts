// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
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
        features: [{ id: "f1", type: "extrude", sketchId: sketch1.id, depth: 10 }],
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
    expect(faceId).toMatch(/^sketch:.+:e[\d.]+:e\d+$/);
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

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

/**
 * Box A (e1) + front boss B fused so A's and B's tops merge into one T-face (e2),
 * plus a disjoint tower T as a separate lump (e3) — its top stays near the captured
 * plane's height, a trap for a purely geometric re-match. The boss sketch lives on
 * A's front face (y = -20), whose sketch-plane UV is literally (x, z).
 */
function setupMergedPlane() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-20, -20, 20, 20) });
    const frontPlane = new Plane({
        origin: new XYZ({ x: 0, y: -20, z: 0 }),
        normal: new XYZ({ x: 0, y: -1, z: 0 }),
        xvec: XYZ.unitX,
    });
    const sketch2 = new SketchNode({ document: doc, plane: frontPlane, data: rect(-10, 12, 10, 20) });
    const sketch3 = new SketchNode({ document: doc, plane: Plane.XY, data: rect(50, 50, 60, 60) });
    doc.modelManager.addNode(sketch1);
    doc.modelManager.addNode(sketch2);
    doc.modelManager.addNode(sketch3);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            { id: "e1", type: "extrude", sketchId: sketch1.id, depth: 20 },
            { id: "e2", type: "extrude", sketchId: sketch2.id, depth: 10, operation: "fuse" },
            { id: "e3", type: "extrude", sketchId: sketch3.id, depth: 21, operation: "fuse" },
        ],
    });
    doc.modelManager.addNode(body);
    return { doc, sketch2, body };
}

describe("sketch plane on a merged face (real kernel)", () => {
    test("a re-split merge follows the descendant piece, not an unrelated nearer face", () => {
        const { doc, sketch2, body } = setupMergedPlane();
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);

        // Capture the merged T-top (z = 20; the tower top sits at z = 21) exactly as
        // the sketch command does — with the tracked face id.
        const faces = () => body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const topIndex = faces().findIndex(
            (face) => face.normal(0, 0)[1].z > 0.9 && Math.abs(face.normal(0, 0)[0].z - 20) < 1e-6,
        );
        expect(topIndex).toBeGreaterThanOrEqual(0);
        const faceId = body.faceIdAt(topIndex);
        // The merge compounds both ancestors' ids (multi-valued boolean history).
        expect(faceId).toContain("|");
        const ref: PlaneFaceRef = { ...captureFaceRef(body.id, faces()[topIndex]), faceId };
        const captured = resolveFacePlane(doc, ref);
        expect(captured).toBeDefined();
        expect(captured!.normal.dot(captured!.origin)).toBeCloseTo(20, 6);

        // Raise the box and re-draw the boss higher: the merge re-splits into a box-top
        // piece (z = 40) and a boss-top piece (z = 30) — neither on the captured plane,
        // while the untouched tower top (z = 21) is now the geometrically nearest.
        body.setFeaturesEmitShapeChanged(body.features.map((f) => (f.id === "e1" ? { ...f, depth: 40 } : f)));
        sketch2.setDataEmitShapeChanged(rect(-10, 22, 10, 30));
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
        const offsets = faces()
            .filter((face) => face.normal(0, 0)[1].z > 0.9)
            .map((face) => Math.round(face.normal(0, 0)[0].z));
        expect(offsets.sort((a, b) => a - b)).toEqual([21, 30, 40]);

        // The exact id is gone; both re-split pieces still carry one of its components.
        expect(body.faceIndexById(faceId!)).toBeUndefined();
        expect(body.faceIndexesOfId(faceId!)).toHaveLength(2);

        // Lineage beats proximity: the plane follows the boss-top descendant at z = 30,
        // never the unrelated but nearer tower top at z = 21.
        const plane = resolveFacePlane(doc, ref);
        expect(plane).toBeDefined();
        expect(plane!.normal.z).toBeCloseTo(1, 6);
        expect(plane!.normal.dot(plane!.origin)).toBeCloseTo(30, 6);
    });
});
