// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BoundingBox, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { RevolveFeatureData } from "../src/features/feature";
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

/** Profile rectangle x ∈ [10, 20], z ∈ [0, 30] in the XZ plane — clear of the Z axis. */
const profile = (): SketchData => rect(10, 0, 20, 30);

/** Full-turn volume of the profile: π(20² − 10²)·30. */
const FULL_TURN = Math.PI * (20 * 20 - 10 * 10) * 30;

function revolvedBody(doc: TestDocument, feature: Partial<RevolveFeatureData>): ParametricBodyNode {
    const sketch = new SketchNode({ document: doc, plane: XZ_PLANE, data: profile() });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "r1",
                type: "revolve",
                sketchId: sketch.id,
                axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                angle: 90,
                ...feature,
            },
        ],
    });
    doc.modelManager.addNode(body);
    return body;
}

function scene() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);
const bbox = (body: ParametricBodyNode): BoundingBox => body.shape.unchecked()!.boundingBox();

describe("revolve second side (real kernel)", () => {
    test("angle2 sweeps the opposite side by its own angle", () => {
        const doc = scene();
        const body = revolvedBody(doc, { angle: 90, angle2: 90 });

        expect(errors(body)).toEqual([undefined]);
        // 90° + 90° = a half turn of the profile.
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(FULL_TURN / 2, 0);
        // The sector reaches 20 to BOTH sides of the profile plane — a single-sided
        // revolve would keep one of |min.y|, |max.y| at 0.
        const bounds = bbox(body);
        expect(bounds.min.y).toBeCloseTo(-20, 1);
        expect(bounds.max.y).toBeCloseTo(20, 1);
    });

    test("symmetric sweeps half the total angle to each side", () => {
        const doc = scene();
        const body = revolvedBody(doc, { angle: 180, symmetric: true });

        expect(errors(body)).toEqual([undefined]);
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(FULL_TURN / 2, 0);
        const bounds = bbox(body);
        expect(bounds.min.y).toBeCloseTo(-20, 1);
        expect(bounds.max.y).toBeCloseTo(20, 1);
        // The two tracked halves fuse at the profile plane; every face keeps its name.
        const faceIds = (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).map((_, i) =>
            body.faceIdAt(i),
        );
        expect(faceIds.filter((id) => id === undefined)).toEqual([]);
    });

    test("a single angle sweeps one side only", () => {
        const doc = scene();
        const body = revolvedBody(doc, { angle: 90 });

        expect(errors(body)).toEqual([undefined]);
        expect(body.shape.unchecked()!.volume()).toBeCloseTo(FULL_TURN / 4, 0);
        const bounds = bbox(body);
        // One side of the profile plane stays empty (the sweep sense is the kernel's).
        expect(Math.min(Math.abs(bounds.min.y), Math.abs(bounds.max.y))).toBeCloseTo(0, 1);
        expect(Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y))).toBeCloseTo(20, 1);
    });

    test("symmetric and angle2 together are a rebuild error", () => {
        const doc = scene();
        const body = revolvedBody(doc, { angle: 90, angle2: 30, symmetric: true });

        expect(body.shape.isOk).toBe(false);
        expect(errors(body)).toEqual(["Revolve cannot be both symmetric and have a second angle"]);
    });

    test("a non-positive angle2 is a rebuild error", () => {
        const doc = scene();
        const body = revolvedBody(doc, { angle: 90, angle2: 0 });

        expect(body.shape.isOk).toBe(false);
        expect(errors(body)).toEqual(["Revolve angle2 must be positive"]);
    });
});
