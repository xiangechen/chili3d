// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import type { ExtrudeFeatureData, FeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { prismSideFaces } from "../src/features/sweepGeometry";
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

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function addSketch(doc: TestDocument, id: string, data: SketchData) {
    const sketch = new SketchNode({ document: doc, id, plane: Plane.XY, data });
    doc.modelManager.addNode(sketch);
    const profile = sketch.mesh.faces?.range.find((x) => x.shape.shapeType === ShapeTypes.face);
    expect(profile).toBeDefined();
    return { sketch, profile: profile!.shape as unknown as IFace };
}

/** A body whose single extrude of the 40×40 sketch stands 20 tall, plus `extra` overrides. */
function setup(extra: Partial<ExtrudeFeatureData> = {}) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const { sketch, profile } = addSketch(doc, "sk1", rect(-20, -20, 20, 20));
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 20,
                profiles: [captureProfileRef(profile)],
                ...extra,
            } as ExtrudeFeatureData,
        ],
    });
    doc.modelManager.addNode(body);
    return { doc, body };
}

const volumeOf = (body: ParametricBodyNode) => round(body.shape.unchecked()!.volume());

const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];

/** The area of the end cap parallel to the sketch plane at height `z` (either normal sense). */
function capAreaAt(body: ParametricBodyNode, z: number): number {
    const face = facesOf(body).find((candidate) => {
        const [point, normal] = candidate.normal(0, 0);
        return Math.abs(Math.abs(normal.z) - 1) < 1e-6 && Math.abs(point.z - z) < 1e-6;
    });
    expect(face).toBeDefined();
    return round(face!.area());
}

// A 40×40×20 prism tapered 5° about its base: cross-section side 40 − 2z·tan5°, so the
// volume is 1600·20 − 40·2tan5°·400 + (4tan²5°/3)·8000 and the top cap (40 − 40tan5°)².
const TAPERED_VOLUME = 29282.01; // the same taper the draft feature measured on this geometry
const TAPERED_TOP_AREA = 1332.28;
const FLARED_VOLUME = 34881.28;
const FLARED_TOP_AREA = 1892.21;

describe("extrude with draft angle (real kernel)", () => {
    test("a positive angle narrows the prism toward its end", () => {
        const { body } = setup({ draftAngle: 5 });
        expect(body.shape.isOk).toBe(true);

        expect(facesOf(body).length).toBe(6);
        expect(volumeOf(body)).toBeCloseTo(TAPERED_VOLUME, 1);
        expect(capAreaAt(body, 20)).toBeCloseTo(TAPERED_TOP_AREA, 1);
        // The base lies ON the neutral plane — the taper rotates about it, leaving it exact.
        expect(capAreaAt(body, 0)).toBe(1600);
    });

    test("a negative angle flares the prism", () => {
        const { body } = setup({ draftAngle: -5 });
        expect(body.shape.isOk).toBe(true);

        expect(volumeOf(body)).toBeCloseTo(FLARED_VOLUME, 1);
        expect(capAreaAt(body, 20)).toBeCloseTo(FLARED_TOP_AREA, 1);
    });

    test("reverse sweeps the tapered prism to the opposite side", () => {
        const { body } = setup({ draftAngle: 5, reverse: true });
        expect(body.shape.isOk).toBe(true);

        // Same taper, mirrored: the narrow cap is at −20 and the draft still rotates about
        // the base, which stays exact on the neutral plane.
        expect(volumeOf(body)).toBeCloseTo(TAPERED_VOLUME, 1);
        expect(capAreaAt(body, 0)).toBe(1600);
        expect(capAreaAt(body, -20)).toBeCloseTo(TAPERED_TOP_AREA, 1);
        const box = body.shape.unchecked()!.boundingBox();
        expect(round(box.min.z)).toBe(-20);
        expect(round(box.max.z)).toBe(0);
    });

    test("a symmetric sweep tapers both halves off the shared start plane", () => {
        const { body } = setup({ draftAngle: 5, symmetric: true });
        expect(body.shape.isOk).toBe(true);

        expect(volumeOf(body)).toBeCloseTo(2 * TAPERED_VOLUME, 1);
        expect(capAreaAt(body, 20)).toBeCloseTo(TAPERED_TOP_AREA, 1);
        expect(capAreaAt(body, -20)).toBeCloseTo(TAPERED_TOP_AREA, 1);
        // The widest section is the waist at the sketch plane, parting-line style.
        const box = body.shape.unchecked()!.boundingBox();
        expect(round(box.max.x)).toBe(20);
        expect(round(box.min.z)).toBe(-20);
    });

    test("zero is the straight-sided prism, unchanged", () => {
        const { body } = setup({ draftAngle: 0 });
        expect(body.shape.isOk).toBe(true);
        expect(volumeOf(body)).toBe(32000);
    });

    test.each([
        [{ draftAngle: 95 }, "strictly between -90 and 90"],
        [{ draftAngle: -90 }, "strictly between -90 and 90"],
    ] as const)("hand-edited data %o fails the feature rather than the kernel", (extra, message) => {
        const { body } = setup(extra as Partial<ExtrudeFeatureData>);
        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0]?.error).toContain(message);
    });

    test("depth2 tapers the backward half off the same start plane", () => {
        const { body } = setup({ draftAngle: 5, depth: 12, depth2: 8 });
        expect(body.shape.isOk).toBe(true);

        // ∫(40 − 2z·tan5°)² dz over [0, 12] plus over [0, 8] (the backward half).
        expect(volumeOf(body)).toBeCloseTo(18209.77 + 12357.28, 1);
        expect(capAreaAt(body, 12)).toBeCloseTo((40 - 24 * Math.tan((5 * Math.PI) / 180)) ** 2, 1);
        expect(capAreaAt(body, -8)).toBeCloseTo((40 - 16 * Math.tan((5 * Math.PI) / 180)) ** 2, 1);
    });

    test("a throughAll cut with draft leaves a tapered through-hole", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const { sketch: sketch1, profile: profile1 } = addSketch(doc, "sk1", rect(-20, -20, 20, 20));
        const { sketch: sketch2, profile: profile2 } = addSketch(doc, "sk2", rect(-10, -10, 10, 10));
        const body = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch1.id,
                    depth: 20,
                    profiles: [captureProfileRef(profile1)],
                },
                {
                    id: "e2",
                    type: "extrude",
                    sketchId: sketch2.id,
                    depth: 20,
                    endCondition: "throughAll",
                    operation: "cut",
                    draftAngle: 3,
                    profiles: [captureProfileRef(profile2)],
                } as ExtrudeFeatureData,
            ],
        });
        doc.modelManager.addNode(body);

        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        // The inferred overshoot only extends the taper past the box: inside it the void is
        // ∫(20 − 2z·tan3°)² dz over [0, 20] — and the hole DOES go through.
        expect(volumeOf(body)).toBeCloseTo(32000 - 7190.77, 1);
    });

    test("a drafted cut tapers the void through the tracked boolean", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const { sketch: sketch1, profile: profile1 } = addSketch(doc, "sk1", rect(-20, -20, 20, 20));
        const { sketch: sketch2, profile: profile2 } = addSketch(doc, "sk2", rect(-10, -10, 10, 10));
        const body = new ParametricBodyNode({
            document: doc,
            id: "b1",
            features: [
                {
                    id: "e1",
                    type: "extrude",
                    sketchId: sketch1.id,
                    depth: 20,
                    profiles: [captureProfileRef(profile1)],
                },
                {
                    id: "e2",
                    type: "extrude",
                    sketchId: sketch2.id,
                    depth: 15,
                    operation: "cut",
                    draftAngle: 3,
                    profiles: [captureProfileRef(profile2)],
                } as ExtrudeFeatureData,
            ],
        });
        doc.modelManager.addNode(body);

        expect(body.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
        // The tool is a 20×20×15 prism narrowed by 3° toward its top: the void is
        // ∫(20 − 2z·tan3°)² dz from 0 to 15.
        expect(volumeOf(body)).toBeCloseTo(26459.31, 1);
    });

    test("the tapered faces keep their ids across an upstream edit", () => {
        const { body } = setup({ draftAngle: 5 });
        expect(body.shape.isOk).toBe(true);
        const surfaceIds = () => facesOf(body).map((_, index) => body.faceIdAt(index));
        const before = surfaceIds();
        expect(before.every((id) => id !== undefined)).toBe(true);

        body.setFeaturesEmitShapeChanged([{ ...body.features[0], depth: 25 } as FeatureData]);
        expect(body.featureItems().map((x) => x.error)).toEqual([undefined]);
        expect([...surfaceIds()].sort()).toEqual([...before].sort());
        expect(volumeOf(body)).toBeCloseTo(35785.03, 1);
    });

    test("prismSideFaces picks the four sides, tapered or not", () => {
        const straight = setup();
        expect(straight.body.shape.isOk).toBe(true);
        const vec = new XYZ(0, 0, 20);
        expect(prismSideFaces(straight.body.shape.unchecked()!, XYZ.zero, XYZ.unitZ, vec).length).toBe(4);

        const tapered = setup({ draftAngle: 5 });
        expect(tapered.body.shape.isOk).toBe(true);
        expect(prismSideFaces(tapered.body.shape.unchecked()!, XYZ.zero, XYZ.unitZ, vec).length).toBe(4);
    });
});
