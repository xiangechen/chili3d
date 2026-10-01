// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BoundingBox, type IFace, Matrix4, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { allProfiles, sketchProfiles } from "../src/features/profileBuilder";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";
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

const square = (size: number): SketchData => {
    const h = size / 2;
    return {
        entities: [
            { id: 1, type: "line", params: [-h, -h, h, -h] },
            { id: 2, type: "line", params: [h, -h, h, h] },
            { id: 3, type: "line", params: [h, h, -h, h] },
            { id: 4, type: "line", params: [-h, h, -h, -h] },
        ],
        constraints: [],
    };
};

/** A rectangle in the sketch's own coordinates. */
const rect = (x1: number, y1: number, x2: number, y2: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x1, y1, x2, y1] },
        { id: 2, type: "line", params: [x2, y1, x2, y2] },
        { id: 3, type: "line", params: [x2, y2, x1, y2] },
        { id: 4, type: "line", params: [x1, y2, x1, y1] },
    ],
    constraints: [],
});

const planeAt = (z: number, x = 0) =>
    new Plane({ origin: new XYZ({ x, y: 0, z }), normal: XYZ.unitZ, xvec: XYZ.unitX });

function profileOf(sketch: SketchNode) {
    const profiles = sketchProfiles(sketch);
    expect(profiles.isOk).toBe(true);
    const all = allProfiles(profiles.value);
    expect(all).toHaveLength(1);
    return captureProfileRef(all[0] as IFace);
}

/** A 40×40×40 box (local: x,y ∈ [-20,20], z ∈ [0,40]) extruded from a sketch. */
function box(doc: TestDocument): ParametricBodyNode {
    const sketch = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: square(40) });
    doc.modelManager.addNode(sketch);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth: 40,
                profiles: [profileOf(sketch)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return body;
}

function worldBox(body: ParametricBodyNode): BoundingBox {
    return BoundingBox.transformed(body.shape.unchecked()!.boundingBox(), body.worldTransform());
}

const errors = (body: ParametricBodyNode) => body.featureItems().map((x) => x.error);

describe("a feature joining into a transformed body (real kernel)", () => {
    test("an extrude join is placed where its sketch is, not at the host's local origin", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = box(doc);
        body.transform = Matrix4.fromTranslation(100, 0, 0);

        // A sketch sitting on the moved box's top face, in WORLD coordinates: the box
        // now spans world x ∈ [80,120], so its top face's middle is at x=100, z=40.
        const top = new SketchNode({ document: doc, id: "sk2", plane: planeAt(40, 100), data: square(20) });
        doc.modelManager.addNode(top);

        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "e2",
                type: "extrude",
                sketchId: top.id,
                depth: 20,
                operation: "fuse",
                profiles: [profileOf(top)],
            },
        ]);

        expect(errors(body)).toEqual([undefined, undefined]);
        const result = worldBox(body);
        // The join lands on the box's top face at world x ∈ [90,110] — the box's own
        // world span is x ∈ [80,120], so nothing grows sideways.
        expect(result.min.x).toBeCloseTo(80, 1);
        expect(result.max.x).toBeCloseTo(120, 1);
        expect(result.max.z).toBeCloseTo(60, 1);
    });

    test("a revolve cut is placed where its profile is, not at the host's local origin", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = box(doc);
        body.transform = Matrix4.fromTranslation(100, 0, 0);

        // A full-turn revolve about the world axis through (100, 0, 0) along +Y, of a
        // profile starting on that axis: a cylinder of radius 50 that swallows the moved
        // box whole (its world span is x ∈ [80,120], z ∈ [0,40]).
        const profile = new SketchNode({
            document: doc,
            id: "sk2",
            plane: planeAt(0, 100),
            data: rect(0, -25, 50, 25),
        });
        doc.modelManager.addNode(profile);
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "r1",
                type: "revolve",
                sketchId: profile.id,
                axis: { point: { x: 100, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
                angle: 360,
                operation: "cut",
                profiles: [profileOf(profile)],
            },
        ]);

        expect(errors(body)).toEqual([undefined, undefined]);
        // Nothing of the box survives the cut.
        expect(body.shape.unchecked()!.findSubShapes(ShapeTypes.face)).toHaveLength(0);
    });

    test("a loft join onto a transformed host stays on the face it was built from", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const body = box(doc);
        body.transform = Matrix4.fromTranslation(100, 0, 0);

        // The box's own top face (world z=40) to a smaller square at world z=60.
        const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const topIndex = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
        expect(topIndex).toBeGreaterThanOrEqual(0);
        const faceId = body.faceIdAt(topIndex);

        const top = new SketchNode({ document: doc, id: "sk2", plane: planeAt(60, 100), data: square(20) });
        doc.modelManager.addNode(top);
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "l1",
                type: "loft",
                sections: [
                    {
                        kind: "profile",
                        nodeId: body.id,
                        profile: captureProfileRef(
                            faces[topIndex],
                            faceId,
                            body.faceIdIsShared(faceId),
                            true,
                        ),
                    },
                    { kind: "profile", nodeId: top.id, profile: profileOf(top) },
                ],
                isSolid: true,
                isRuled: false,
                continuity: "c2",
                operation: "fuse",
            },
        ]);

        expect(errors(body)).toEqual([undefined, undefined]);
        const result = worldBox(body);
        expect(result.min.x).toBeCloseTo(80, 1);
        expect(result.max.x).toBeCloseTo(120, 1);
        expect(result.max.z).toBeCloseTo(60, 1);
    });
});
